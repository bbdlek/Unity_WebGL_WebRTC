using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.UI;

public class WebRTCManager : MonoBehaviour
{
    // JS
    [DllImport("__Internal")]
    public static extern void StartWebSocketConnection();
    
    // Settings
    public bool useVideo = false;
    public bool useAudio = false;
    
    // Video
    public RawImage localVideo;
    public GameObject remoteVideoPanel;
    public GameObject remoteVideoObj;
    
    // Cam
    private WebCamTexture _camTexture;
    private int _currentWebCamIndex = 0;
    
    // Audio
    private AudioSource audioSource;
    private AudioClip audioClip;
    
    // MyStreamData
    public Dictionary<string, Texture2D> MyStreamData = new Dictionary<string, Texture2D>();
    
    // StreamData (StreamId, AudioClip, Video)
    // 우선은 Audio는 StreamId로 Web 관리
    public Dictionary<string, (AudioClip, Texture2D)> StreamData = new Dictionary<string, (AudioClip, Texture2D)>();

    private void Awake()
    {
        audioSource = GetComponent<AudioSource>();
        Debug.Log("Sample Rate: " +  AudioSettings.outputSampleRate);
        Debug.Log("Sample Rate: " +  AudioSettings.GetConfiguration().dspBufferSize);
    }

    private void Start()
    {
        Debug.Log(useVideo);
        Debug.Log(useAudio);
        if (useVideo)
        {
            WebCamDevice[] devices = WebCamTexture.devices;
            for (int i = 0; i < devices.Length; i++)
            {
                Debug.Log($"Device {devices[i].name}");
            }
        
            WebCamDevice device = WebCamTexture.devices[_currentWebCamIndex];
            _camTexture = new WebCamTexture(device.name, 320, 240);
            localVideo.texture = _camTexture;
            _camTexture.Play();
        }
        
    }

    public void OnConnected(string streamID)
    {
        if(!MyStreamData.ContainsKey(streamID))
        {
            MyStreamData.Add(streamID, new Texture2D(640, 360, TextureFormat.RGBA32, false));
            Debug.Log($"{streamID} is My StreamID");
        }
    }

    public void OnDisconnected(string streamID)
    {
        if (MyStreamData.ContainsKey(streamID))
        {
            // MyStreamData에서 streamID에 해당하는 Texture2D를 가져옵니다.
            Texture2D texture = MyStreamData[streamID];

            // Texture2D를 명시적으로 해제합니다.
            if (texture != null)
            {
                Destroy(texture);
            }

            // 딕셔너리에서 해당 streamID를 제거합니다.
            MyStreamData.Remove(streamID);
            Debug.Log($"{streamID} is My StreamID And Disconnected");
        }
    }


    public void OnConnectedWithClient(string streamID)
    {
        if (!StreamData.ContainsKey(streamID))
        {
            StreamData.Add(streamID,
                new ValueTuple<AudioClip, Texture2D>(AudioClip.Create($"{streamID}AudioClip", 4096, 1, 44100, false),
                    new Texture2D(320, 180, TextureFormat.RGBA32, false)));
            Debug.Log($"{streamID} is Connected");
            GameObject remoteVideo = Instantiate(remoteVideoObj, remoteVideoPanel.transform);
            remoteVideo.GetComponent<RawImage>().texture = StreamData[streamID].Item2;
        }
    }

    public void OnDisconnectedWithClient(string streamID)
    {
        if (StreamData.ContainsKey(streamID))
        {
            // 먼저 해당 streamID에 연결된 AudioClip과 Texture2D를 가져옵니다.
            var streamData = StreamData[streamID];

            // AudioClip과 Texture2D를 명시적으로 해제합니다.
            if (streamData.Item1 != null)
            {
                Destroy(streamData.Item1);
            }
        
            if (streamData.Item2 != null)
            {
                Destroy(streamData.Item2);
            }

            // 딕셔너리에서 해당 streamID를 제거합니다.
            StreamData.Remove(streamID);
            Debug.Log($"{streamID} is Disconnected");
        }
    }


    public void ReceiveVideoFrame(string combinedData)
    {
        if(!useVideo) return;
        
        string[] dataParts = combinedData.Split(':');
        string streamId = dataParts[0];
        string base64Data = dataParts[1];
        
        // Texture2D 생성
        byte[] imageData = System.Convert.FromBase64String(base64Data);
        if(StreamData.ContainsKey(streamId))
        {
            StreamData[streamId].Item2.LoadImage(imageData);
            StreamData[streamId].Item2.Apply();
        }
    }

    // 버퍼용 변수 선언
    private List<float> audioBuffer = new List<float>();
    private const int bufferSize = 4096; // 예시로 1초 분량

    public void ReceiveAudioFrame(string base64Data)
    {
        if(!useAudio) return;
        
        if (string.IsNullOrEmpty(base64Data))
        {
            Debug.LogError("Received base64Data is null or empty.");
            return;
        }
        else
        {
            Debug.Log(base64Data.Length);
        }

        try
        {
            byte[] audioBytes = Convert.FromBase64String(base64Data);
            if (audioBytes == null || audioBytes.Length == 0)
            { 
                Debug.LogError("Decoded audioBytes is null or empty.");
                return;
            }

            float[] audioFloats = ConvertPCM16ToFloats(audioBytes);

            // 수신된 데이터를 버퍼에 추가
            audioBuffer.AddRange(audioFloats);

            // 버퍼가 설정된 크기에 도달하면 오디오 클립에 반영
            if (audioBuffer.Count >= bufferSize)
            {
                // AudioClip 생성 또는 업데이트
                float[] bufferArray = audioBuffer.ToArray();
                audioClip = AudioClip.Create("IncomingAudio", bufferArray.Length, 1, 44100, false);
                audioClip.SetData(bufferArray, 0);
        
                // 오디오 소스에 클립 설정 후 재생
                audioSource.clip = audioClip;
                audioSource.loop = false; // 필요한 경우 true로 설정
                audioSource.Play();

                // 사용한 데이터 제거
                audioBuffer.Clear();
            }
        }
        catch (FormatException ex)
        {
            Debug.LogError($"FormatException: {ex.Message}");
        }
        catch (Exception ex)
        {
            Debug.LogError($"Exception: {ex.Message}");
        }
    }
    
    // 16-bit PCM 데이터를 float 배열로 변환하는 함수
    private float[] ConvertPCM16ToFloats(byte[] pcm16Data)
    {
        int floatCount = pcm16Data.Length / 2;  // 16-bit PCM은 2바이트이므로
        float[] floats = new float[floatCount];

        for (int i = 0; i < floatCount; i++)
        {
            short pcmSample = BitConverter.ToInt16(pcm16Data, i * 2);  // Little Endian으로 변환
            floats[i] = pcmSample / 32768.0f;  // 16-bit PCM을 -1.0f ~ 1.0f 범위의 float로 변환
        }

        return floats;
    }
}
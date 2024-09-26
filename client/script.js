// WebSocket 및 Peer 객체를 전역 변수로 선언
let socket;
let peer;
let canvas2;
let ctx;
let audioContext;
let processor;
let myStreamId;
let Streams = {};
let videoElements = {}; // 스트림 ID에 대한 비디오 요소 저장
let audioProcessors = {}; // 스트림 ID에 대한 오디오 프로세서 노드 저장
let connected = false;

let savedWidth, savedHeight, savedRate;

document.getElementById('joinRoomButton').addEventListener('click', () => {
    const roomId = document.getElementById('roomIdInput').value;
    if (roomId) {
        startWebSocketConnection(roomId); // 방 ID로 연결 시작
    } else {
        console.warn('유효한 방 ID를 입력하세요.');
    }
});

async function startWebSocketConnection(roomId) {
    if(connected) return;
    connected = true;
    try {

        let localStream = await getMediaStream();
        myStreamId = localStream.id;
        Streams[localStream.id] = localStream;

        // MCU 서버와 WebSocket 연결 설정
        socket = new WebSocket('ws://192.168.154.117:8081');
        peer = new SimplePeer({ initiator: true, trickle: false, stream: localStream });

        socket.onopen = () => {
            console.log('Connected to MCU server');
            socket.send(JSON.stringify({ joinRoom: roomId}));
            SendMyStreamConnected(localStream.id);
        };

        socket.onmessage = event => {
            const data = JSON.parse(event.data);
            if (data.signal) {
                console.log('Received signal from MCU server:', data.signal);
                peer.signal(data.signal);
            }

            if (data.type === 'peer-disconnected') {
                console.log('피어가 연결을 끊었습니다:', data.streamId);

                removeStream(data.streamId);
            }

            if (data.type === 'newPeer') {
                console.log('새로운 피어가 참가함:', data.peerId);
            }
        };

        socket.onclose = () => {
            console.log('Disconnect to Server');
            SendMyStreamDisconnected(localStream.id);
            connected = false;
        }

        peer.on('signal', signal => {
            console.log('Sending signal to MCU server:', signal);
            socket.send(JSON.stringify({ signal }));
        });

        peer.on('stream', stream => {
            console.log('Received stream from peer');

            // 이미 스트림이 추가되었는지 확인
            if (Streams[stream.id]) {
                console.log('이미 수신된 스트림');
                return;
            }

            Streams[stream.id] = stream;
            SendOtherStreamConnected(stream.id);

            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length > 0) {
                console.log('Received audio track count: ', audioTracks.length);
                console.log('Received audio track:', audioTracks[0]);
                setupAudioProcessing(stream);
            } else {
                console.warn('No audio track received.');
            }
            if(stream.getVideoTracks().length > 0)
            {
                const newVideo = document.createElement('video');
                newVideo.autoplay = true;
                newVideo.playsInline = true;
                newVideo.muted = true;

                newVideo.srcObject = stream;
                newVideo.setAttribute('data-peer-id', stream.id); // 사용자 정의 속성에 ID 저장

                // remoteVideo.style.visibility = 'hidden';
                // 비디오 요소의 스타일 설정
                newVideo.style.display = 'inline-block'; // 가로로 나란히 표시
                newVideo.style.width = '300px'; // 원하는 너비
                newVideo.style.height = '200px'; // 원하는 높이
                newVideo.style.margin = '5px'; // 비디오 간의 간격 조정

                document.getElementById('video-container').appendChild(newVideo);
                videoElements[stream.id] = newVideo;

                newVideo.addEventListener('loadeddata', () => {
                    // Canvas와 Context를 초기화합니다
                    if (!canvas2) {
                        canvas2 = document.createElement('canvas');
                        ctx = canvas2.getContext('2d');
                        canvas2.width = newVideo.videoWidth;
                        canvas2.height = newVideo.videoHeight;
                    }
                    function updateCanvas() {
                        ctx.drawImage(newVideo, 0, 0, canvas2.width, canvas2.height);

                        canvas2.toBlob(blob => {
                            if (blob) { // blob이 null이 아닌 경우
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    // const arrayBuffer = reader.result;
                                    SendVideoFrameToUnity(stream.id, reader.result);
                                    blob = null;
                                };
                                reader.readAsDataURL(blob);
                            } else {
                                console.warn('Blob is null. No data to send to Unity.');
                            }
                        }, 'image/jpeg', 0.7);

                        // 애니메이션 프레임의 개수를 제한하여 호출
                        // 30 FPS로 제한 (기본값)
                        setTimeout(() => requestAnimationFrame(updateCanvas), 1000 / 30);
                    }

                    updateCanvas();
                });
            }

        });

        peer.on('error', err => {
            console.error('Peer connection error:', err);
        });

        // Test
        // Track 수 확인 버튼 이벤트 리스너 추가
        document.getElementById('checkTracksButton').addEventListener('click', () => {
            // remoteStreams 객체의 값(스트림들)을 배열로 가져옵니다
            const streams = Object.values(Streams);

            streams.forEach((remoteStream) => {
                if (remoteStream) {
                    const tracks = remoteStream.getTracks();
                    console.log(`Track count: ${tracks.length}`);
                    tracks.forEach((track, index) => {
                        console.log(`Track ${index + 1}: Kind = ${track.kind}, ID = ${track.id}`);
                    });
                } else {
                    console.log('No stream available');
                }
            });
        });

        // Volume Test
        const streamIdInput = document.getElementById('streamIdInput');
        const volumeInput = document.getElementById('volumeInput');
        const volumeValue = document.getElementById('volumeValue');
        const setVolumeButton = document.getElementById('setVolumeButton');

        volumeInput.addEventListener('input', () => {
            volumeValue.textContent = volumeInput.value;
        });

        setVolumeButton.addEventListener('click', () => {
            console.log('SetVolumeBtn Clicked');
            const streamId = streamIdInput.value;
            const volume = parseFloat(volumeInput.value);

            if(streamId) {
                SetVolume(streamId, volume);
            } else {
                console.warn('Please provide a valid Stream ID.');
            }
        });

        // Mute Test
        const muteInput = document.getElementById('doMute');
        const setMuteButton = document.getElementById('setMuteButton');

        setMuteButton.addEventListener('click', () => {
            console.log('SetMuteBtn Clicked');
            const streamId = streamIdInput.value;
            const muteValue = muteInput.checked;

            if(streamId) {
                SetMute(streamId, muteValue);
            } else {
                console.warn('Please provide a valid Stream ID.');
            }
        })

        // Video Test
        const turnOnInput = document.getElementById('doTurnOn');
        const setVideoTurnOnButton = document.getElementById('setVideoTurnOn');

        setVideoTurnOnButton.addEventListener('click', () => {
            console.log('SetVideoTurnOnBtn Clicked');
            const streamId = streamIdInput.value;
            const turnOnValue = turnOnInput.checked;

            if(streamId) {
                SetVideo(streamId, turnOnValue);
            } else {
                console.warn('Please provide a valid Stream ID.');
            }
        })

        const screenShareOnBtn = document.getElementById('screenShareOn');
        const screenShareOffBtn = document.getElementById('screenShareOff');

        screenShareOnBtn.addEventListener('click', () => {
            console.log('screenShareOnBtn Clicked');
            startScreenShare();
        })

        screenShareOffBtn.addEventListener('click', async () => {
            console.log('screenShareOnBtn Clicked');
            await stopScreenShare();
        })

        // Close Test
        const closeButton = document.getElementById('leaveRoomButton');

        closeButton.addEventListener('click', () => {
            console.log('LeaveRoomBtn Clicked');

            LeaveRoom();
        })

        // Resolution Test
        document.getElementById('setResolutionButton').addEventListener('click', async () => {
            const streamId = streamIdInput.value;
            const width = parseInt(document.getElementById('resolutionWidth').value);
            const height = parseInt(document.getElementById('resolutionHeight').value);

            if (width > 0 && height > 0) {
                await SetVideoResolution(width, height, 30);
                // 스트림을 WebRTC에 연결하는 추가 로직 작성
            } else {
                console.warn('유효한 해상도를 입력하세요.');
            }
        });

    } catch (error) {
        console.error('Error accessing media devices:', error);
    }
}

function SetVolume(streamId, volume)
{
    if(volume < 0) volume = 0;
    if(volume > 1) volume = 1;

    // 오디오 프로세서
    const audioProcessor = audioProcessors[streamId];

    if (!audioProcessor || !audioProcessor.gainNode) {
        console.warn('No GainNode found for stream:', streamId);
        return;
    }

    // 볼륨을 설정합니다
    audioProcessor.gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
    console.log(`Volume for stream ${streamId} set to ${volume}`);
}

function SetMute(streamId, doMute)
{
    const stream = Streams[streamId];
    if(stream) {
        const audioTracks = stream.getAudioTracks();
        audioTracks.forEach(track => {
            console.log(doMute);
            track.enabled = doMute;
        })
    }
}

function SetVideo(streamId, doTurnOn)
{
    const stream = Streams[streamId];
    if(stream) {
        const audioTracks = stream.getVideoTracks();
        audioTracks.forEach(track => {
            track.enabled = doTurnOn;
        })
    }
}

async function SetVideoResolution(width, height, frame)
{
    const stream = Streams[myStreamId];
    if(stream) {
        const videoTrack = stream.getVideoTracks()[0];

        if(videoTrack) {
            videoTrack.stop();
        }

        const newStream = await getMediaStream(width, height, frame);
        const newVideoTrack = newStream.getVideoTracks()[0];

        stream.removeTrack(videoTrack);
        stream.addTrack(newVideoTrack);

        peer.replaceTrack(videoTrack, newVideoTrack, stream);
    }
}

function startScreenShare() {
    navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
    }).then(stream => {
        const videoTrack = stream.getVideoTracks()[0];
        videoTrack.addEventListener('ended' , async () => {
            await stopScreenShare();
        });

        const existingStream = Streams[myStreamId];
        if(existingStream) {
            const existingVideoTrack = existingStream.getVideoTracks()[0];
            if(existingVideoTrack)
            {
                existingVideoTrack.stop();
                existingStream.removeTrack(existingVideoTrack);
            }

            existingStream.addTrack(videoTrack);
            peer.replaceTrack(existingVideoTrack, videoTrack, existingStream);
        }
    })
}

async function stopScreenShare() {
    await SetVideoResolution(savedWidth, savedHeight, savedRate);
}

function LeaveRoom()
{
    if(socket && socket.readyState === WebSocket.OPEN){
        socket.close();
    }
}

// Unity Funcs
// 자신 접속
function SendMyStreamConnected(streamId)
{
    gameInstance.SendMessage('WebRTCManager', 'OnConnected', streamId);
}

// 자신 접속 해제
function SendMyStreamDisconnected(streamId)
{
    gameInstance.SendMessage('WebRTCManager', 'OnDisconnected', streamId);
}

// 다른 사람 접속
function SendOtherStreamConnected(streamId)
{
    gameInstance.SendMessage('WebRTCManager', 'OnConnectedWithClient', streamId);
}

// 다른 사람 접속 해제
function SendOtherStreamDisconnected(streamId)
{
    gameInstance.SendMessage('WebRTCManager', 'OnDisconnectedWithClient', streamId);
}

// Unity로 비디오 프레임 데이터를 전송하는 함수
function SendVideoFrameToUnity(streamId, imageDataUrl) {
    // 데이터 크기를 Unity가 읽을 수 있는 형식으로 변환
    const base64Data = imageDataUrl.split(',')[1];

    // 두 개의 인자를 하나의 문자열로 연결 (예: "streamId:base64Data")
    const combinedData = `${streamId}:${base64Data}`;

    // Unity로 데이터 전송
    gameInstance.SendMessage('WebRTCManager', 'ReceiveVideoFrame', combinedData);
}

// 스트림 제거 함수
function removeStream(streamId) {
    // 비디오 요소 제거
    if (videoElements[streamId]) {
        const video = videoElements[streamId];
        video.srcObject.getTracks().forEach(track => track.stop()); // 트랙 중지
        video.remove(); // DOM에서 비디오 요소 제거
        delete videoElements[streamId]; // 비디오 요소 객체에서 제거
        console.log('연결 끊긴 피어의 비디오를 제거했습니다:', streamId);
    }

    // 오디오 프로세서 제거
    if (audioProcessors[streamId]) {
        const processorNode = audioProcessors[streamId];
        if (processorNode.port) { // port가 존재하는지 확인
            processorNode.port.close(); // 포트 닫기
        }
        delete audioProcessors[streamId]; // 오디오 프로세서 객체에서 제거
        console.log('연결 끊긴 피어의 오디오 프로세서를 제거했습니다:', streamId);
    }

    // remoteStreams 객체에서 스트림 제거
    if (Streams[streamId]) {
        delete Streams[streamId];
        console.log('연결 끊긴 피어의 스트림을 제거했습니다:', streamId);
        SendOtherStreamDisconnected(streamId);
    }
}

let audioProcessingInitialized = false; // 오디오 처리 초기화 여부를 추적하는 변수

async function setupAudioProcessing(stream) {
    if (audioProcessingInitialized) {
        console.warn('Audio processing is already initialized. Skipping setup.');
    }else{
        // AudioContext 생성
        console.warn('Audio Context Initialized');
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    audioProcessingInitialized = true; // 오디오 처리를 초기화 상태로 설정

    try {

        // Audio Worklet Processor 로드
        await audioContext.audioWorklet.addModule('audio-processor.js');

        // AudioWorkletNode 생성
        const processorNode = new AudioWorkletNode(audioContext, 'my-audio-processor');

        // GainNode 생성
        const gainNode = audioContext.createGain();

        // MediaStreamSource와 AudioWorkletNode를 연결합니다
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(processorNode);
        processorNode.connect(gainNode);             // AudioWorkletNode -> GainNode
        gainNode.connect(audioContext.destination);  // GainNode -> Destination

        // 기본 볼륨 설정 (1: 최대 볼륨)
        gainNode.gain.setValueAtTime(1, audioContext.currentTime);

        processorNode.port.onmessage = (event) => {
            // 프로세서에서 전달된 메시지를 처리합니다
            const audioData = event.data;
            // 예: Unity로 오디오 데이터 전송 처리
            // if (event.data.audioData) {
            //     const pcm16Data = convertFloat32ToPCM16(audioData.audioData);
            //     SendAudioDataToUnity(pcm16Data);
            // }
        };

        processorNode.port.postMessage('메인 스레드에서 보낸 메시지'); // 예제 메시지

        processorNode.onprocessorerror = (event) => {
            console.error('AudioWorkletProcessor 오류:', event);
        };

        // 스트림 ID에 GainNode와 ProcessorNode 저장
        audioProcessors[stream.id] = {
            processorNode: processorNode,
            gainNode: gainNode
        };

    } catch (error) {
        console.error('Error setting up audio worklet:', error);
        audioProcessingInitialized = false; // 오류 발생 시 초기화 상태를 다시 설정
    }
}


// Float32Array를 16-bit PCM으로 변환하는 함수
function convertFloat32ToPCM16(float32Array) {
    const pcm16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        pcm16Array[i] = Math.max(-1, Math.min(1, float32Array[i])) * 32767;
    }
    return pcm16Array;
}

// 16-bit PCM 데이터를 Base64로 인코딩하는 함수
function pcm16ArrayToBase64(pcm16Array) {
    const uint8Array = new Uint8Array(pcm16Array.buffer);
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
        binaryString += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binaryString);
}


function SendAudioDataToUnity(pcm16Data) {
    // Base64 인코딩
    const base64Data = pcm16ArrayToBase64(pcm16Data);

    // Unity로 데이터 전송
    gameInstance.SendMessage('WebRTCManager', 'ReceiveAudioFrame', base64Data);
}

async function getMediaStream(width = 640, height = 360, frame = 30)
{
    console.log(`width : ${width}, height : ${height}, frame : ${frame}`);
    savedWidth = width;
    savedHeight = height;
    savedRate = frame;
    const devices = await navigator.mediaDevices.enumerateDevices();

    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    const videoInputs = devices.filter(device => device.kind === 'videoinput');

    let videoEnable = false;
    let audioEnable = false;

    if(videoInputs.length > 0)
    {
        console.log("Available video input devices:");
        videoInputs.forEach((device, index) => {
            console.log(`${index}: ${device.label}`);
        });
        videoEnable = true;
    }

    if(audioInputs.length > 0)
    {
        console.log("Available audio input devices:");
        audioInputs.forEach((device, index) => {
            console.log(`${index}: ${device.label}`);
        });
        audioEnable = true;
    }

    const constraints = {
        audio: audioEnable ? {
            sampleRate: 44100,            // 48kHz 샘플레이트 (고품질 오디오)
            sampleSize: 16,               // 16비트 오디오 샘플 사용
            channelCount: 1,              // 스테레오 오디오 설정
            echoCancellation: false,       // 에코 제거 활성화
            noiseSuppression: true,       // 노이즈 억제 활성화
            autoGainControl: false,        // 자동 게인 제어 활성화
            latency: 0                   // 가능한 낮은 지연 시간 설정
        } : false,
        video: videoEnable ? {
            width: { ideal: width },     // 원하는 가로 해상도
            height: { ideal: height },   // 원하는 세로 해상도
            frameRate: { ideal: frame },    // 프레임 레이트 (선택 사항)
        } : false
    };

    // 비디오 장치와 오디오 장치를 각각 0번과 1번으로 선택
    // const chosenVideoDeviceId = videoInputs[0]?.deviceId;
    // const chosenAudioDeviceId = audioInputs[0]?.deviceId;
    //
    // if (!chosenVideoDeviceId || !chosenAudioDeviceId) {
    //     console.error("Unable to find the specified audio or video device.");
    //     return;
    // }
    //
    // const streamConstraints = {
    //     // video: { deviceId: { exact: chosenVideoDeviceId } },
    //     video : false,
    //     audio: {
    //         ...constraints.audio,  // 기본 오디오 제약 조건 적용
    //         deviceId: { exact: chosenAudioDeviceId } // 선택한 오디오 장치 설정
    //     }
    // };

    try {
        // 장치가 있는 경우 해당 장치로 MediaStream 얻기
        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

        // 마이크 볼륨을 제어하기 위해 AudioContext 생성
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioContext.createMediaStreamSource(mediaStream);

        // 볼륨 제어를 위한 GainNode 생성
        const gainNode = audioContext.createGain();

        // 초기 볼륨 설정
        gainNode.gain.setValueAtTime(1, audioContext.currentTime);

        // GainNode를 통해 오디오를 처리하고 MediaStream 생성
        const destination = audioContext.createMediaStreamDestination();
        source.connect(gainNode);
        gainNode.connect(destination);

        // destination.stream은 변경된 오디오 스트림을 포함
        const processedStream = new MediaStream();

        // 원본의 비디오 트랙을 유지
        mediaStream.getVideoTracks().forEach(track => processedStream.addTrack(track));

        // 처리된 오디오 트랙을 추가
        destination.stream.getAudioTracks().forEach(track => processedStream.addTrack(track));

        // 오디오 프로세서와 함께 저장
        audioProcessors[processedStream.id] = {
            gainNode: gainNode
        };

        return processedStream; // WebRTC로 전송될 처리된 스트림
    } catch (err) {
        console.warn('No media devices available or access denied:', err);

        // 빈 MediaStream을 반환
        return new MediaStream();
    }
}

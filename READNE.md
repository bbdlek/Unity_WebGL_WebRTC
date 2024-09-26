## CLIENT USAGE
### 1. 원하는 Project에 Plugins에 Unity/test.jslib 추가
### 2. 해당 Project에서 WebRTCManager.cs 사용해서 구현
### 3. 해당 Unity Project Build(Webgl)
### 4. 빌드해서 나온 폴더에 client/script.js 추가
### 5. 빌드해서 나온 index.html에 아래 코드 추가
```html
<div id="video-container" style="display: flex; flex-wrap: wrap; justify-content: flex-start; align-items: center;"></div>
<!-- SimplePeer 라이브러리 추가 -->
<script src="https://unpkg.com/simple-peer@9.11.0/simplepeer.min.js"></script>

<!-- script.js 파일을 불러옵니다 -->
<script src="script.js"></script>
```
### 6. python -m http.server PORT 로 테스트 가능<br/><br/> 중요!! webrtc는 https에서만 가능하니 테스트 시 해당 브라우저에서 Insecure origins treated as secure Allow 해줄것<br/><br/>

## SERVER USAGE
### node ./server/mcu-server.js

## TEST USAGE
### client 폴더에서 위의 CLIENT USAGE와 마찬가지로 python -m http.server PORT 로 테스트 가능
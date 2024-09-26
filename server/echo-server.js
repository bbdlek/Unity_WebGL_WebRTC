const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const SimplePeer = require('simple-peer');
const wrtc = require('wrtc');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Unity WebGL 클라이언트의 URL을 명시해도 됩니다.
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log('New client connected');

    let peer;

    socket.on('offer', (offer) => {
        peer = new SimplePeer({
            initiator: false,
            trickle: false,
            wrtc
        });

        peer.signal(offer);

        peer.on('signal', (answer) => {
            socket.emit('answer', answer);
        });

        peer.on('stream', (stream) => {
            peer.addStream(stream); // 에코를 위해 다시 클라이언트로 스트림을 보냅니다.
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        if (peer) {
            peer.destroy();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

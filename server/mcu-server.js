const http = require('http');
const WebSocket = require('ws');
const SimplePeer = require('simple-peer');
const wrtc = require('wrtc');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

const peers = new Map(); // 어떤 ws에 연결된 ServerPeer
const streams = new Map(); // 여러 개의 스트림을 저장할 수 있도록 변경
const addedTracks = new Map();

const rooms = new Map(); // Room 관리

class TaskQueue {
    constructor() {
        this.queue = [];
        this.isProcessing = false;
    }

    add(task) {
        this.queue.push(task);
        this.process();
    }

    async process() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift();
            await task();
        }

        this.isProcessing = false;
    }
}

const taskQueue = new TaskQueue();

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

wss.on('connection', ws => {
    const peer = new SimplePeer({ initiator: false, trickle: false, wrtc });
    peer.id = generateUUID(); // 피어에 고유 ID 할당
    console.log('New client connected ID: ', peer.id);

    peers.set(ws, peer);

    peer.on('signal', signal => {
        ws.send(JSON.stringify({ signal }));
    });

    ws.on('message', async message => {
        console.log('Received message from client:', message);
        const data = JSON.parse(message);

        taskQueue.add(async () => {
            if (data.signal) {
                peer.signal(data.signal); // 순차적으로 처리
            } else if (data.joinRoom) {
                // Room에 참여
                console.log("JoinRoom");
                const roomId = data.joinRoom;
                if (!rooms.has(roomId)) {
                    rooms.set(roomId, { clients: new Set(), streams: new Map() }); // Room 초기화
                }
                const room = rooms.get(roomId);
                room.clients.add(ws); // 현재 클라이언트를 Room에 추가

                // 해당 Room의 다른 클라이언트에게 새로운 참가자 알림
                room.clients.forEach(clientWs => {
                    if (clientWs !== ws) {
                        clientWs.send(JSON.stringify({ type: 'newPeer', peerId: peer.id }));
                    }
                });
            }
        });
    });

    peer.on('stream', stream => {
        taskQueue.add(async () => {
            console.log(`Received stream from peer`);

            const currentRoom = Array.from(rooms.values()).find(room => room.clients.has(ws)); // 현재 peer에 해당하는 방 찾기

            // 기존 피어의 스트림 리스트가 없으면 초기화
            if(!currentRoom.streams.has(peer))
            {
                currentRoom.streams.set(peer, []);
            }

            // 새로운 스트림을 추가
            currentRoom.streams.get(peer).push(stream);
            console.log(`Total streams for this peer: ${currentRoom.streams.get(peer).length}`);

            // 피어별로 추가된 트랙 관리 초기화
            if (!addedTracks.has(peer)) {
                addedTracks.set(peer, new Set());
            }

            // 새로운 피어가 연결되면, 현재까지 받은 모든 스트림을 새 피어에게 공유
            currentRoom.streams.forEach((streamList, peerKey) => {
                if (peerKey !== peer) { // peerKey가 현재 peer가 아닐 때만 실행
                    streamList.forEach(existingStream => {
                        existingStream.getTracks().forEach(track => {
                            taskQueue.add(async () => {
                                const trackId = `${existingStream.id}-${track.id}`;
                                // 트랙이 이미 추가되었는지 확인
                                if (!addedTracks.get(peer).has(trackId)) {
                                    peer.addTrack(track, existingStream); // 트랙을 순차적으로 추가
                                    addedTracks.get(peer).add(trackId); // 추가된 트랙을 기록
                                    console.log('Track from existing stream added to peer');
                                } else {
                                    console.log('Track already added to peer, skipping');
                                }
                            });
                        });
                    });
                }
            });

            // 새 스트림의 트랙을 다른 피어에게 공유
            currentRoom.clients.forEach((existingWs) => {
                const existingPeer = peers.get(existingWs);
                if (existingPeer !== peer && !existingPeer.destroyed) {
                    // 트랙이 추가되기 전에 addedTracks에 Set이 존재하는지 확인
                    if (!addedTracks.has(existingPeer)) {
                        addedTracks.set(existingPeer, new Set()); // Set 초기화
                    }

                    stream.getTracks().forEach(track => {
                        taskQueue.add(async () => {
                            const trackId = `${stream.id}-${track.id}`;
                            // 트랙이 이미 추가되었는지 확인
                            if (!addedTracks.get(existingPeer).has(trackId)) {
                                existingPeer.addTrack(track, stream); // 트랙 추가를 순차적으로 처리
                                addedTracks.get(existingPeer).add(trackId); // 추가된 트랙을 기록
                                console.log(`Track from new stream added to peer: ${existingWs}`); // 수정된 부분
                            } else {
                                console.log(`Track already added to peer: ${existingWs}, skipping`);
                            }
                        });
                    });
                }
            })
        });
    });


    ws.on('close', () => {
        console.log(`Client disconnected`);
        const disconnectedPeer = peers.get(ws);

        // 연결이 끊긴 피어의 모든 스트림을 확인하고, 각 스트림의 ID를 다른 피어에게 전달
        const disconnectedRoom = Array.from(rooms.values()).find(room => room.clients.has(ws));
        if(disconnectedRoom && disconnectedRoom.streams.has(disconnectedPeer)){
            const peerStreams = disconnectedRoom.streams.get(disconnectedPeer);

            peerStreams.forEach(stream => {
                const streamId = stream.id;
                disconnectedRoom.clients.forEach((existingWs) => {
                    const existingPeer = peers.get(existingWs);
                    if(existingPeer !== disconnectedPeer && !existingPeer.destroyed)
                    {
                        // 각 피어에게 연결이 끊긴 스트림 ID를 알림
                        existingWs.send(JSON.stringify({ type: 'peer-disconnected', streamId: streamId }));
                    }
                });
            });

            // 연결이 끊긴 피어의 모든 스트림 삭제
            disconnectedRoom.streams.delete(disconnectedPeer);
        }

        if (!disconnectedPeer.destroyed) {
            disconnectedPeer.destroy();
        }
        peers.delete(ws);

        if(disconnectedRoom) {
            disconnectedRoom.clients.delete(ws);
            if(disconnectedRoom.clients.length === 0){
                rooms.delete(disconnectedRoom);
            }
        }
    });

    peer.on('error', err => {
        console.error('Peer connection error:', err);
    });
});

server.listen(8081, () => {
    console.log('SFU server running on ws://localhost:8081');
});

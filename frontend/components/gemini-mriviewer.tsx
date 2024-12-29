'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, StopCircle, Video } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { base64ToFloat32Array, float32ToPcm16 } from '@/lib/utils';

interface Config {
  systemPrompt: string;
  voice: string;
  googleSearch: boolean;
  allowInterruptions: boolean;
}

export default function GeminiVoiceChat() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [config, setConfig] = useState<Config>({
    systemPrompt: `You are a Gemini 2.0 model acting as a multilingual medical assistant specialized in the preliminary analysis of Magnetic Resonance Imaging (MRI) scans. 
  
  I will provide you with an MRI image in a compatible format (e.g., DICOM, NIfTI). 
  
  **Please follow these instructions:**
  
  1. **Analyze** the image for relevant features such as signal intensity, contrast, and visible patterns. 
  2. **Respond** concisely and informatively to each of my questions or requests related to the image analysis. 
  3. **Always respond in the same language as the input prompt.**
  4. **Focus** on providing the most relevant and helpful information for each specific question.
  
  **Example:**
  
  * **Me:** "Describe the type of slice in this image."
  * **You:** "This appears to be an axial slice."
  
  I may have multiple questions about the image. Please answer each question individually and to the best of your ability based on the visual information provided.`,
    voice: "Puck",
    googleSearch: true,
    allowInterruptions: false,
  });

  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioInputRef = useRef(null);
  const clientId = useRef(crypto.randomUUID());
  const [videoEnabled, setVideoEnabled] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [chatMode, setChatMode] = useState<'audio' | 'video' | null>(null);

  const voices = ["Puck", "Charon", "Kore", "Fenrir", "Aoede"];
  let audioBuffer = []
  let isPlaying = false

  const startStream = async (mode: 'audio' | 'video') => {
    setChatMode(mode);
    wsRef.current = new WebSocket(`ws://localhost:8000/ws/${clientId.current}`);

    wsRef.current.onopen = async () => {
      wsRef.current.send(JSON.stringify({
        type: 'config',
        config: config
      }));

      await startAudioStream();
      if (mode === 'video') {
        setVideoEnabled(true);
      }
      setIsStreaming(true);
      setIsConnected(true);
    };

    wsRef.current.onmessage = async (event) => {
      const response = JSON.parse(event.data);
      if (response.type === 'audio') {
        const audioData = base64ToFloat32Array(response.data);
        playAudioData(audioData);
      } else if (response.type === 'text') {
        setText(prev => prev + response.text + '\n');
      }
    };

    wsRef.current.onerror = (error) => {
      setError('WebSocket error: ' + error.message);
      setIsStreaming(false);
    };

    wsRef.current.onclose = () => {
      setIsStreaming(false);
    };
  };

  // Initialize audio context and stream
  const startAudioStream = async () => {
    try {
      // Initialize audio context
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000 // Required by Gemini
      });

      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create audio input node
      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(512, 1, 1);

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = float32ToPcm16(inputData);
          // Convert to base64 and send as binary
          const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
          wsRef.current.send(JSON.stringify({
            type: 'audio',
            data: base64Data
          }));
        }
      };

      source.connect(processor);
      processor.connect(audioContextRef.current.destination);

      audioInputRef.current = { source, processor, stream };
      setIsStreaming(true);
    } catch (err) {
      setError('Failed to access microphone: ' + err.message);
    }
  };

  // Stop streaming
  const stopStream = () => {
    if (audioInputRef.current) {
      const { source, processor, stream } = audioInputRef.current;
      source.disconnect();
      processor.disconnect();
      stream.getTracks().forEach(track => track.stop());
      audioInputRef.current = null;
    }

    if (chatMode === 'video') {
      setVideoEnabled(false);
      if (videoStreamRef.current) {
        videoStreamRef.current.getTracks().forEach(track => track.stop());
        videoStreamRef.current = null;
      }
      if (videoIntervalRef.current) {
        clearInterval(videoIntervalRef.current);
        videoIntervalRef.current = null;
      }
    }

    // stop ongoing audio playback
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsStreaming(false);
    setIsConnected(false);
    setChatMode(null);
  };

  const playAudioData = async (audioData) => {
    audioBuffer.push(audioData)
    if (!isPlaying) {
      playNextInQueue(); // Start playback if not already playing
    }
  };

  const playNextInQueue = async () => {
    if (!audioContextRef.current || audioBuffer.length == 0) {
      isPlaying = false;
      return;
    }

    isPlaying = true
    const audioData = audioBuffer.shift()

    const buffer = audioContextRef.current.createBuffer(1, audioData.length, 24000);
    buffer.copyToChannel(audioData, 0);

    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => {
      playNextInQueue()
    }
    source.start();
  };

  useEffect(() => {
    if (videoEnabled && videoRef.current) {
      const startScreenShare = async () => {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              mediaSource: "screen"
            }
          });

          videoRef.current.srcObject = stream;
          videoStreamRef.current = stream;

          // Start frame capture after screen is shared
          videoIntervalRef.current = setInterval(() => {
            captureAndSendFrame();
          }, 1000);

        } catch (err) {
          console.error('Screen share initialization error:', err);
          setError('Failed to access screen: ' + err.message);
          setVideoEnabled(false);
        }
      };

      startScreenShare();

      // Cleanup function
      return () => {
        if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach(track => track.stop());
          videoStreamRef.current = null;
        }
        if (videoIntervalRef.current) {
          clearInterval(videoIntervalRef.current);
          videoIntervalRef.current = null;
        }
      };
    }
  }, [videoEnabled]);

  // Frame capture function
  const captureAndSendFrame = () => {
    if (!canvasRef.current || !videoRef.current || !wsRef.current) return;

    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;

    context.drawImage(videoRef.current, 0, 0);
    const base64Image = canvasRef.current.toDataURL('image/jpeg').split(',')[1];

    wsRef.current.send(JSON.stringify({
      type: 'image',
      data: base64Image
    }));
  };

  // Toggle video function
  const toggleVideo = () => {
    setVideoEnabled(!videoEnabled);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStream();
    };
  }, []);

  // return (
  //   <div className="container mx-auto py-8 px-4">
  //     <div className="space-y-6">
  //       <h1 className="text-4xl font-bold tracking-tight">AI-Powered MRI Viewer ✨</h1>

  //       {error && (
  //         <Alert variant="destructive">
  //           <AlertTitle>Error</AlertTitle>
  //           <AlertDescription>{error}</AlertDescription>
  //         </Alert>
  //       )}

  //       <Card>
  //         <CardContent className="pt-6 space-y-4">
  //           <div className="space-y-2">
  //             <Label htmlFor="system-prompt">System Prompt</Label>
  //             <Textarea
  //               id="system-prompt"
  //               value={config.systemPrompt}
  //               onChange={(e) => setConfig(prev => ({ ...prev, systemPrompt: e.target.value }))} 
  //               disabled={isConnected}
  //               className="min-h-[100px]"
  //             />
  //           </div>

  //           <div className="space-y-2">
  //             <Label htmlFor="voice-select">Voice</Label>
  //             <Select
  //               value={config.voice}
  //               onValueChange={(value) => setConfig(prev => ({ ...prev, voice: value }))} 
  //               disabled={isConnected}
  //             >
  //               <SelectTrigger id="voice-select">
  //                 <SelectValue placeholder="Select a voice" />
  //               </SelectTrigger>
  //               <SelectContent>
  //                 {voices.map((voice) => (
  //                   <SelectItem key={voice} value={voice}>
  //                     {voice}
  //                   </SelectItem>
  //                 ))}
  //               </SelectContent>
  //             </Select>
  //           </div>

  //           <div className="flex items-center space-x-2">
  //             <Checkbox
  //               id="google-search"
  //               checked={config.googleSearch}
  //               onCheckedChange={(checked) => 
  //                 setConfig(prev => ({ ...prev, googleSearch: checked as boolean }))} 
  //               disabled={isConnected}
  //             />
  //             <Label htmlFor="google-search">Enable Google Search</Label>
  //           </div>
  //         </CardContent>
  //       </Card>

  //       <div className="flex gap-4">
  //         {!isStreaming && (
  //           <>
  //             <Button
  //               onClick={() => startStream('audio')}
  //               disabled={isStreaming}
  //               className="gap-2"
  //             >
  //               <Mic className="h-4 w-4" />
  //               Start Chatting
  //             </Button>

  //             <Button
  //               onClick={() => startStream('video')}
  //               disabled={isStreaming}
  //               className="gap-2"
  //             >
  //               <Video className="h-4 w-4" />
  //               Start Screen Sharing
  //             </Button>
  //           </>
  //         )}

  //         {isStreaming && (
  //           <Button
  //             onClick={stopStream}
  //             variant="destructive"
  //             className="gap-2"
  //           >
  //             <StopCircle className="h-4 w-4" />
  //             Stop Chat
  //           </Button>
  //         )}
  //       </div>

  //       {isStreaming && (
  //         <Card>
  //           <CardContent className="flex items-center justify-center h-24 mt-6">
  //             <div className="flex flex-col items-center gap-2">
  //               <Mic className="h-8 w-8 text-blue-500 animate-pulse" />
  //               <p className="text-gray-600">Listening...</p>
  //             </div>
  //           </CardContent>
  //         </Card>
  //       )}

  //       {chatMode === 'video' && (
  //         <Card>
  //           <CardContent className="pt-6 space-y-4">
  //             <div className="flex justify-between items-center">
  //               <h2 className="text-lg font-semibold">Screen Sharing</h2>
  //             </div>

  //             <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
  //               <video
  //                 ref={videoRef}
  //                 autoPlay
  //                 playsInline
  //                 muted
  //                 width={320}
  //                 height={240}
  //                 className="w-full h-full object-contain"
  //               />
  //               <canvas
  //                 ref={canvasRef}
  //                 className="hidden"
  //               />
  //             </div>
  //           </CardContent>
  //         </Card>
  //       )}

  //       <div className="overflow-hidden py-4">
  //         <textarea
  //           readOnly
  //           value={text}
  //           className="w-full h-[200px] text-sm border rounded-lg p-4 bg-gray-100 resize-none"
  //         />
  //       </div>
  //     </div>
  //   </div>
  // );


  return (
    <div className="container mx-auto py-8 px-4">
      <div className="space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">Gemini 2.0 Realtime Playground ✨</h1>
        
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="system-prompt">System Prompt</Label>
              <Textarea
                id="system-prompt"
                value={config.systemPrompt}
                onChange={(e) => setConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                disabled={isConnected}
                className="min-h-[100px]"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="voice-select">Voice</Label>
              <Select
                value={config.voice}
                onValueChange={(value) => setConfig(prev => ({ ...prev, voice: value }))}
                disabled={isConnected}
              >
                <SelectTrigger id="voice-select">
                  <SelectValue placeholder="Select a voice" />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((voice) => (
                    <SelectItem key={voice} value={voice}>
                      {voice}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="google-search"
                checked={config.googleSearch}
                onCheckedChange={(checked) => 
                  setConfig(prev => ({ ...prev, googleSearch: checked as boolean }))}
                disabled={isConnected}
              />
              <Label htmlFor="google-search">Enable Google Search</Label>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-4">
          {!isStreaming && (
            <>
            <Button
              onClick={() => startStream('audio')}
              disabled={isStreaming}
              className="gap-2"
          >
            <Mic className="h-4 w-4" />
            Start Chatting
          </Button>

          <Button
            onClick={() => startStream('video')}
            disabled={isStreaming}
            className="gap-2"
          >
            <Video className="h-4 w-4" />
              Start Chatting with Video
            </Button>
            </>
          )}

          {isStreaming && (
            <Button
              onClick={stopStream}
              variant="destructive"
              className="gap-2"
            >
              <StopCircle className="h-4 w-4" />
              Stop Chat
            </Button>
          )}
        </div>

        {isStreaming && (
          <Card>
            <CardContent className="flex items-center justify-center h-24 mt-6">
              <div className="flex flex-col items-center gap-2">
                <Mic className="h-8 w-8 text-blue-500 animate-pulse" />
                <p className="text-gray-600">Listening...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {chatMode === 'video' && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-semibold">Video Input</h2>
              </div>
              
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  width={320}
                  height={240}
                  className="w-full h-full object-contain"
                  style={{ transform: 'scaleX(-1)' }}
                />
                <canvas
                  ref={canvasRef}
                  className="hidden"
                  width={640}
                  height={480}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {text && (
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-2">Conversation:</h2>
              <pre className="whitespace-pre-wrap text-gray-700">{text}</pre>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
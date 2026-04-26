import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Navbar from "./components/Navbar";
import MusicCarousel from "./components/MusicCarousel"
import MusicInfo from "./components/MusicInfo"
import MusicControls from "./components/MusicControls"

function App() {
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        await invoke("audio_load", {
          // Relative to src-tauri/ (Tauri's CWD in dev) — replace with CAS hash lookup once the storage layer is built
          path: "../tests/audio/test.mp3",
          metadata: { title: "Test Track", artist: "Test Artist", album: null, artwork_path: null, duration_ms: null },
        });
        await invoke("audio_play");
      } catch (e) {
        console.error("[audio] load/play failed:", e);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <div className="flex justify-center items-center pb-6 pt-6">
        <MusicCarousel />
      </div>

      <div className="flex justify-center items-center">
        <MusicInfo />
      </div>

      <div className="flex justify-center items-center">
        <MusicControls />
      </div>
    </div>
  );
}

export default App;

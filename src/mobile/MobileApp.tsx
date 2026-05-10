import Navbar from '../components/Navbar';
import MusicCarousel from '../components/MusicCarousel';
import MusicInfo from '../components/MusicInfo';
import MusicControls from '../components/MusicControls';

export default function MobileApp() {
  return (
    <div className="flex flex-col min-h-screen bg-neutral">
      <Navbar />
      <main className="flex flex-col flex-1 items-center justify-center gap-6 px-4 py-6">
        <MusicCarousel />
        <MusicInfo />
        <MusicControls />
      </main>
    </div>
  );
}

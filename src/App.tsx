import { isMobile } from './shared/platform';
import DesktopApp from './desktop/DesktopApp';
import MobileApp from './mobile/MobileApp';

export default function App() {
  return isMobile ? <MobileApp /> : <DesktopApp />;
}

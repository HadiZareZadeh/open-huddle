import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LandingPage } from '@/pages/LandingPage';
import { MeetingPage } from '@/pages/MeetingPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/meeting/:id" element={<MeetingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

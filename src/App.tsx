import { BrowserRouter, Routes, Route } from 'react-router';
import HomeScreen from './components/HomeScreen.tsx';
import ChatView from './components/ChatView.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/chat/:chatId" element={<ChatView />} />
      </Routes>
    </BrowserRouter>
  );
}

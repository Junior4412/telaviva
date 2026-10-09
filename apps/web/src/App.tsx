import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { HomePage } from "./pages/Home";
import { RoomPage } from "./pages/Room";
import { RoomProvider } from "./state/RoomContext";

/**
 * Shell da aplicação com as rotas.
 *
 * O estado da sala fica em um provedor acima do roteador para sobreviver à
 * navegação entre a home e a sala — quem cria uma sala já entra nela e a
 * página da sala precisa refletir isso sem pedir a senha de novo.
 *
 * O convite usa a forma curta `/r/CODIGO`, que é fácil de digitar e compartilhar.
 * Qualquer outra rota volta para a home em vez de mostrar 404, porque a home
 * é o ponto de entrada de criação e de entrada em salas.
 */
export default function App() {
  return (
    <RoomProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/r/:roomCode" element={<RoomPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </RoomProvider>
  );
}

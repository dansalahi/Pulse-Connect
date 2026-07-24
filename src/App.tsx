import { useEffect } from "react";
import { LoadingScreen } from "./components/LoadingScreen";
import { MainLayout } from "./pages/MainLayout";
import { LoginPage } from "./pages/LoginPage";
import { useAuthStore } from "./store/authStore";
import { mountEventBridge } from "./lib/eventBridge";

export default function App() {
  const { isAuthenticated, isLoading, bootstrap } = useAuthStore();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Call signaling, overlay action, and global hotkey listeners for the
  // app's lifetime. See src/lib/eventBridge.ts.
  useEffect(() => {
    mountEventBridge();
  }, []);

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <LoginPage />;
  return <MainLayout />;
}

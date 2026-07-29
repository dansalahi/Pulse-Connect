/**
 * App root: gates rendering on auth bootstrap (loading → login → main layout)
 * and mounts the global Tauri event bridge for the app's lifetime.
 */
import { useEffect } from "react";
import { LoadingScreen } from "../ui/LoadingScreen";
import { MainLayout } from "./MainLayout";
import { LoginPage } from "../features/auth/components/LoginPage";
import { useAuthStore } from "../features/auth/store/authStore";
import { mountEventBridge } from "../lib/eventBridge";

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

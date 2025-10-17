import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import App from "@/App";

export default function ChatLayout() {
  const { user, loading } = useAuth();
  const params = useParams<{ id: string }>();

  // Trong khi kiểm tra trạng thái đăng nhập, hiển thị loading
  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">Đang tải...</p>
      </div>
    );
  }

  // Nếu người dùng cố gắng truy cập một chat cụ thể (`/chat/:id`) nhưng chưa đăng nhập,
  // chuyển hướng họ về trang chat chính.
  if (params.id && !user) {
    return <Navigate to="/chat" replace />;
  }

  // Trong tất cả các trường hợp hợp lệ khác (khách ở /chat, người dùng ở /chat, người dùng ở /chat/:id),
  // hiển thị component App chính.
  return <App />;
}

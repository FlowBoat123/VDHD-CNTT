import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings, UserIcon, LogOut, Menu } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { AuthDialog } from "@/components/AuthDialog.component"; // Import AuthDialog

interface HeaderProps {
  onToggleSidebar?: () => void;
  className?: string;
}

export function Header({ onToggleSidebar, className }: HeaderProps) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    navigate("/logout");
  };

  return (
    <header
      className={`flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 ${className}`}
    >
      {/* Mobile menu button */}
      {onToggleSidebar && (
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          onClick={onToggleSidebar}
        >
          <Menu className="h-4 w-4" />
        </Button>
      )}

      {/* App Title / Logo */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <span className="text-primary-foreground font-medium text-sm">
            🎬
          </span>
        </div>
        <div>
          <h1 className="text-lg font-semibold">MovieBot</h1>
          <p className="text-xs text-muted-foreground">AI Movie Assistant</p>
        </div>
      </div>

      {/* User Info / Navigation */}
      <div className="flex items-center gap-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center gap-2 h-auto p-2"
              >
                <Avatar className="h-8 w-8">
                  {user.photoURL ? (
                    <AvatarImage
                      src={user.photoURL}
                      alt={user.displayName || user.email || "User"}
                    />
                  ) : (
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                      {user.displayName?.[0] || user.email?.[0] || "U"}
                    </AvatarFallback>
                  )}
                </Avatar>
                <span className="hidden sm:block">
                  {user.displayName || user.email}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem className="flex items-center gap-2 cursor-pointer">
                <UserIcon className="h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem className="flex items-center gap-2 cursor-pointer">
                <Settings className="h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="flex items-center gap-2 cursor-pointer text-destructive"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <AuthDialog />
        )}
      </div>
    </header>
  );
}

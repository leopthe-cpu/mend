import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";

import { Logo } from "@/components/brand/Logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { appNav } from "./nav";

// Larger than shadcn's defaults for readability at the counter (Oz, decision
// 22): 17px labels and 22px icons; collapsed padding shrinks so the icon still
// fits the 44px button.
const navButtonClass =
  "text-[1.0625rem] [&>svg]:size-[1.375rem] group-data-[collapsible=icon]:!p-[0.6875rem] data-[active=true]:text-primary data-[active=true]:[&>svg]:text-primary";

export function AppSidebar({ userLabel, onSignOut }: { userLabel: string; onSignOut: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-2 pt-4 pb-2 group-data-[collapsible=icon]:items-center">
        <Link to="/app/board" aria-label="Mend home" className="rounded-md">
          <span className="group-data-[collapsible=icon]:hidden">
            <Logo height={30} />
          </span>
          <span
            aria-hidden
            className="hidden font-mono text-xl font-bold text-foreground group-data-[collapsible=icon]:inline"
          >
            m<span className="text-primary">.</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <nav aria-label="Main">
          <SidebarMenu>
            {appNav.map(({ to, label, icon: Icon }) => {
              const active = pathname === to || pathname.startsWith(`${to}/`);
              return (
                <SidebarMenuItem key={to}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={label}
                    className={navButtonClass}
                  >
                    <Link to={to} aria-current={active ? "page" : undefined}>
                      <Icon aria-hidden />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </nav>
      </SidebarContent>

      <SidebarFooter className="px-2 pb-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="truncate px-2 pb-1 text-base text-muted-foreground group-data-[collapsible=icon]:hidden">
              {userLabel}
            </div>
            <SidebarMenuButton onClick={onSignOut} tooltip="Sign out" className={navButtonClass}>
              <LogOut aria-hidden />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

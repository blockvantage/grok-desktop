import {
  Download,
  MoreHorizontal,
  ImageIcon,
  BookMarked,
  HelpCircle,
  FolderOpen,
  Play,
  Square,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DesktopTaskMenuItems } from "@/components/desktop-task-toggle";
import { useT } from "@/i18n";

/**
 * Single overflow menu for the task workspace header.
 * Primary chrome stays outside; secondary actions live here.
 */
export function TaskOverflowMenu(props: {
  taskId: string;
  modelLabel?: string;
  effortLabel?: string;
  onExport: () => void;
  onRemember?: () => void;
  onImagine?: () => void;
  onHelp?: () => void;
  onOpenFolder?: () => void;
  onResume?: () => void;
  showResume?: boolean;
  onCancel?: () => void;
  showCancel?: boolean;
  onToggleRail?: () => void;
  railOpen?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={props.disabled}
          aria-label={t("workspace.chatActions")}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {(props.modelLabel || props.effortLabel) && (
          <>
            <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">
              {[props.modelLabel, props.effortLabel].filter(Boolean).join(" · ")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}

        {props.onOpenFolder && (
          <DropdownMenuItem onClick={props.onOpenFolder}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" />
            {t("workspace.openFolder")}
          </DropdownMenuItem>
        )}
        <DesktopTaskMenuItems taskId={props.taskId} />
        {props.showResume && props.onResume && (
          <DropdownMenuItem onClick={props.onResume}>
            <Play className="mr-2 h-3.5 w-3.5" />
            {t("workspace.resumeTask")}
          </DropdownMenuItem>
        )}
        {props.onToggleRail && (
          <DropdownMenuItem onClick={props.onToggleRail}>
            {props.railOpen ? (
              <PanelRightClose className="mr-2 h-3.5 w-3.5" />
            ) : (
              <PanelRightOpen className="mr-2 h-3.5 w-3.5" />
            )}
            {props.railOpen
              ? t("workspace.hideSidePanel")
              : t("workspace.showSidePanel")}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={props.onExport}>
          <Download className="mr-2 h-3.5 w-3.5" />
          {t("workspace.saveConversation")}
        </DropdownMenuItem>
        {props.onRemember && (
          <DropdownMenuItem onClick={props.onRemember}>
            <BookMarked className="mr-2 h-3.5 w-3.5" />
            {t("workspace.rememberTakeaways")}
          </DropdownMenuItem>
        )}
        {props.onImagine && (
          <DropdownMenuItem onClick={props.onImagine}>
            <ImageIcon className="mr-2 h-3.5 w-3.5" />
            {t("workspace.createImage")}
          </DropdownMenuItem>
        )}
        {props.onHelp && (
          <DropdownMenuItem onClick={props.onHelp}>
            <HelpCircle className="mr-2 h-3.5 w-3.5" />
            {t("workspace.helpDocs")}
          </DropdownMenuItem>
        )}

        {props.showCancel && props.onCancel && (
          <>
            <DropdownMenuSeparator />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  className="text-destructive-text focus:text-destructive-text"
                >
                  <Square className="mr-2 h-3.5 w-3.5" />
                  {t("workspace.cancelTask")}
                </DropdownMenuItem>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("workspace.cancelTaskTitle")}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("workspace.cancelTaskDesc")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t("workspace.keepRunning")}
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={props.onCancel}>
                    {t("workspace.cancelTask")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

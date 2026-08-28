import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  FolderOpen,
  ListOrdered,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";
import {
  PRODUCT_TOUR_SCENES,
  type ProductTourSceneId,
} from "@/lib/product-tour";

const SCENE_ICONS: Record<
  ProductTourSceneId,
  typeof ShieldCheck
> = {
  approvals: ShieldCheck,
  files: FolderOpen,
  followUps: ListOrdered,
  memory: Bookmark,
  trust: Lock,
};

export function ProductTour(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const completed = useRef(false);

  useEffect(() => {
    if (props.open) {
      setIndex(0);
      completed.current = false;
    }
  }, [props.open]);

  const scene = PRODUCT_TOUR_SCENES[index] ?? PRODUCT_TOUR_SCENES[0]!;
  const last = index >= PRODUCT_TOUR_SCENES.length - 1;
  const Icon = SCENE_ICONS[scene];

  const finish = () => {
    if (completed.current) return;
    completed.current = true;
    props.onComplete();
    props.onOpenChange(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) finish();
        else props.onOpenChange(true);
      }}
    >
      <DialogContent
        className="max-w-md"
        data-testid="product-tour"
        data-tour-scene={scene}
      >
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <DialogTitle>{t(`tour.${scene}.title`)}</DialogTitle>
          <DialogDescription>{t(`tour.${scene}.body`)}</DialogDescription>
        </DialogHeader>
        <p className="text-2xs text-muted-foreground">
          {t("tour.stepOf", {
            current: index + 1,
            total: PRODUCT_TOUR_SCENES.length,
          })}
        </p>
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="product-tour-skip"
            onClick={finish}
          >
            {t("tour.skip")}
          </Button>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="product-tour-back"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                {t("tour.back")}
              </Button>
            ) : null}
            {last ? (
              <Button
                type="button"
                size="sm"
                data-testid="product-tour-done"
                onClick={finish}
              >
                {t("tour.done")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                data-testid="product-tour-next"
                onClick={() =>
                  setIndex((i) =>
                    Math.min(PRODUCT_TOUR_SCENES.length - 1, i + 1),
                  )
                }
              >
                {t("tour.next")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

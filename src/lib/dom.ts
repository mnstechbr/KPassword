import type { MouseEvent } from "react";

export function stopAction(event: MouseEvent) {
  event.stopPropagation();
}

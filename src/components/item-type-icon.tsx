import { UiIcon } from "../UiIcon";
import type { VaultItemType } from "../types";

export function getItemTypeIcon(itemType: VaultItemType) {
  const icons = { credential: "key", secure_note: "note", card: "card", identity: "identity", license: "license", api_key: "key" } as const;
  return <UiIcon name={icons[itemType]} />;
}

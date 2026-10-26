import { LOCAL_DATA_NOTICE } from "../config/public-privacy";
import { isPublicPrivacyMode } from "../utils/public-privacy";

export function LocalDataNotice() {
  if (!isPublicPrivacyMode()) return null;
  return (
    <div
      role="note"
      aria-label="本地数据与隐私提示"
      style={{
        padding: "8px 12px",
        fontSize: 12,
        lineHeight: 1.6,
        flexShrink: 0,
        borderBottom: "1px solid var(--border-in-light)",
      }}
    >
      {LOCAL_DATA_NOTICE}
    </div>
  );
}

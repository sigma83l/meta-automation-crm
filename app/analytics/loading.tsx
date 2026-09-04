import { BrandLoading } from "@/src/components/ui/brand-loading";
import { getRequestPreferences } from "@/src/lib/i18n/server";

export default async function Loading() {
  const { t } = await getRequestPreferences();
  return <BrandLoading label={t("common.loading")} detail={t("nav.analytics")} />;
}

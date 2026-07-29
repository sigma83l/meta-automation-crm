import { serve } from "@/src/vendor/inngest-next-runtime.mjs";

import { inngest } from "@/src/lib/inngest/client";
import { inngestFunctions } from "@/src/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...inngestFunctions]
});

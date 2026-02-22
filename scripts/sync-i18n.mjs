
import fs from "node:fs";
import { en } from "../lib/i18n/messages/en.ts";
import { tr } from "../lib/i18n/messages/tr.ts";
import { it } from "../lib/i18n/messages/it.ts";

function sync(lang, currentMessages, fileName) {
    const newMessages = { ...en };
    // Preserve existing translations
    for (const k of Object.keys(en)) {
        if (currentMessages[k]) {
            newMessages[k] = currentMessages[k];
        }
    }

    const content = `/** i18n Dictionary: ${lang.toUpperCase()} */
export const ${lang} = ${JSON.stringify(newMessages, null, 2)} as const;
`;
    fs.writeFileSync(fileName, content);
    console.log(`Synced ${lang} (${Object.keys(newMessages).length} keys)`);
}

sync("tr", tr, "lib/i18n/messages/tr.ts");
sync("it", it, "lib/i18n/messages/it.ts");

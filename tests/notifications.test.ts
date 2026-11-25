import { describe, expect, it } from "vitest";
import { evaluateTarget } from "../src/lib/core/target";
import { newLowMessage, targetPriceMessage, esc } from "../src/lib/notify/messages";
import { pickRecipients } from "../src/lib/notify/recipients";
import type { Combo } from "../src/lib/core/combos";

const combo: Combo = {
  outbound: { airline: "VY", flightNumber: "VY1540", date: "2027-01-01", depTime: "08:40", arrTime: "10:15", price: 40, currency: "EUR", provider: "t" },
  return: { airline: "FR", flightNumber: "FR5431", date: "2027-01-07", depTime: "19:15", arrTime: "20:50", price: 56, currency: "EUR", provider: "t" },
  baseTotal: 96,
  totalWithBags: 96,
  total: 96,
};
const tracker = {
  id: "abc",
  origin: "BCN" as const,
  destination: "AGP" as const,
  outbound_date: "2027-01-01",
  return_date: "2027-01-07",
  passengers: 1,
  target_price: 100,
};

describe("aviso de nuevo mínimo", () => {
  it("tiene el formato del ejemplo del brief", () => {
    const m = newLowMessage({ tracker, combo, total: 96, drop: 14, appUrl: "https://app" });
    expect(m.text).toContain("🟢 <b>Nuevo mínimo BCN⇄AGP (1–7 ene): 96 €</b>");
    expect(m.text).toContain("ida Vueling 08:40 + vuelta Ryanair 19:15");
    expect(m.text).toContain("Ha bajado 14 € desde el anterior mínimo.");
  });

  it("incluye botones de compra por trayecto y enlace a la app", () => {
    const m = newLowMessage({ tracker, combo, total: 96, drop: 14, appUrl: "https://app" });
    expect(m.buttons[0].map((b) => b.text)).toEqual(["Ida: Vueling ↗", "Vuelta: Ryanair ↗"]);
    expect(m.buttons[0][1].url).toContain("ryanair.com");
    expect(m.buttons[0][1].url).toContain("originIata=AGP");
    expect(m.buttons[1][0].url).toBe("https://app/seguimientos/abc");
  });

  it("escapa HTML", () => expect(esc("<b>&")).toBe("&lt;b&gt;&amp;"));
});

describe("aviso de precio objetivo", () => {
  it("menciona el objetivo y si además es mínimo", () => {
    const m = targetPriceMessage({ tracker, combo, total: 96, isNewLow: true, appUrl: "https://app" });
    expect(m.text).toContain("🎯");
    expect(m.text).toContain("Tu objetivo era 100 €.");
    expect(m.text).toContain("Además es el precio más bajo");
  });

  it("avisa al cruzar el objetivo, no repite y se rearma si sube", () => {
    let notified: number | null = null;
    const seq = [110, 98, 97, 92, 105, 99];
    const out: number[] = [];
    for (const price of seq) {
      const r = evaluateTarget({ price, target: 100, notifiedPrice: notified, minDropEur: 5 });
      if (r.notify) out.push(price);
      notified = r.notifiedPrice;
    }
    expect(out).toEqual([98, 92, 99]);
  });

  it("sin objetivo no avisa", () => {
    expect(evaluateTarget({ price: 1, target: null, notifiedPrice: null, minDropEur: 5 }).notify).toBe(false);
  });
});

describe("destinatarios", () => {
  const profiles = [
    { id: "javier", telegram_chat_id: 111 },
    { id: "novia", telegram_chat_id: 222 },
  ];
  it("los dos si viajan los dos", () => expect(pickRecipients(profiles, null).map((r) => r.id)).toEqual(["javier", "novia"]));
  it("solo quien viaja", () => expect(pickRecipients(profiles, "novia")).toEqual([{ id: "novia", chat: 222 }]));
  it("si quien viaja no tiene Telegram, avisa a quien lo tenga", () =>
    expect(pickRecipients([{ id: "javier", telegram_chat_id: 111 }, { id: "novia", telegram_chat_id: null }], "novia")).toEqual([
      { id: "javier", chat: 111 },
    ]));
});

import { dailySummaryMessage } from "../src/lib/notify/messages";

describe("resumen diario", () => {
  it("lista los viajes con variación, mínimo y recomendación", () => {
    const m = dailySummaryMessage({
      trips: [
        { id: "a", origin: "BCN", destination: "AGP", outbound_date: "2027-01-01", return_date: "2027-01-07", current: 96, previous: 110, lowest: 96, recommendation: "Comprar ya" },
      ],
      activeSales: 1,
      appUrl: "https://app",
    });
    expect(m.text).toContain("BCN⇄AGP 1–7 ene</a>: 96 € ▼14 € (mín. 96 €) · Comprar ya");
    expect(m.text).toContain("🔥 Hay 1 oferta activa");
  });
  it("sin viajes lo dice", () => {
    expect(dailySummaryMessage({ trips: [], activeSales: 0, appUrl: "x" }).text).toContain("No tenéis seguimientos activos.");
  });
});

/** Elige los chats de Telegram: quien viaja (si lo tiene enlazado) o, si no, todos los de la pareja. */
export function pickRecipients(
  profiles: Array<{ id: string; telegram_chat_id: number | null }>,
  travelerId: string | null,
): Array<{ id: string; chat: number }> {
  const linked = profiles.filter((p) => p.telegram_chat_id !== null).map((p) => ({ id: p.id, chat: Number(p.telegram_chat_id) }));
  if (travelerId) {
    const t = linked.find((p) => p.id === travelerId);
    if (t) return [t];
  }
  return linked;
}

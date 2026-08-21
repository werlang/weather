# Alert Templates & Message Formatting Reference

## 1. Alert Message Layout

The alert message generator in `src/telegram_bot.js` (`formatWeatherAlertMessage`) creates structured reports:

```
🚨 *ALERTA METEOROLÓGICO REGIONAL*
📍 *Centro:* Charqueadas - RS (Raio de 50km)
🕒 *Disparado em:* 21/08/2026, 14:30:00
⚠️ *Eventos de Alto Risco:* 1

--------------------------------------------------
[1] 🚨 *TEMPESTADE*
• *Severidade:* OFFICIAL_WARNING (HIGH)
• *Municípios:* Charqueadas, São Jerônimo, Triunfo
• *Janela:* 21/08/2026 12:00 -> 21/08/2026 23:59
• *Motivo:* Aviso meteorológico oficial do INMET (Tempestade - Perigo) com sobreposição na janela de 24h.
• *Detalhes:* Chuva entre 30 e 60 mm/h, ventos intensos (60-100 km/h) e queda de granizo.
--------------------------------------------------

ℹ️ _Defesa Civil RS: 199 | Bombeiros: 193_
```

---

## 2. Character Budget & Chunking Specifications

- **Hard Limit:** 4096 UTF-8 characters per Telegram message.
- **Safe Target Chunk Size:** 3800 - 4000 characters.
- **Boundary Splitting:** Split on paragraph boundaries (`\n\n`) or event delimiters (`---`) first, before line breaks (`\n`), to keep individual event blocks intact.
- **Pagination Header:** Append `[Parte X/Y]` when message exceeds 1 chunk.

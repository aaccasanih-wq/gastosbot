# GastosBot 🤖

Bot personal para el registro y consulta automática de gastos familiares. Funciona 24/7 sin servidor propio.

## ¿Qué hace?

- **Registra gastos automáticamente** desde correos bancarios (BCP, Yape, Interbank)
- **Acepta comandos en lenguaje natural** por Telegram (texto o voz)
- **Multi-usuario** — cada familiar tiene su propia hoja de registros
- **Dashboard visual** con gráficos interactivos *(próximamente — app Streamlit)*

## Stack

| Componente | Tecnología |
|---|---|
| Backend | Google Apps Script |
| Base de datos | Google Spreadsheet |
| Mensajería | Telegram Bot API |
| IA (extracción de datos) | DeepSeek AI |
| IA (transcripción de voz) | Groq Whisper |
| Correos bancarios | Gmail API (nativa en GAS) |

## Comandos disponibles (Telegram)

Todos los comandos se envían en lenguaje natural, por ejemplo:

- *"Gasté 50 soles en almuerzo en efectivo"* → registra gasto en cash
- *"Muéstrame mis últimos 5 gastos"* → lista registros recientes
- *"¿Cuánto gasté esta semana?"* → total del rango
- *"¿Cuánto gasté en comida este mes?"* → total por categoría
- *"Elimina el gasto de ayer en Rappi"* → elimina por criterio
- *"Corrige el monto del gasto #42 a 80 soles"* → edita un campo

## Estructura del proyecto

```
gastosbot/
├── Código.js          # Lógica principal (Google Apps Script)
├── appsscript.json    # Configuración del proyecto GAS
└── .gitignore
```

## Setup (Google Apps Script)

### 1. Requisitos
- Cuenta de Google
- [clasp](https://github.com/google/clasp) instalado (`npm install -g @google/clasp`)
- Bot de Telegram creado con [@BotFather](https://t.me/BotFather)
- API key de [DeepSeek](https://platform.deepseek.com/)
- API key de [Groq](https://console.groq.com/)

### 2. Clonar y subir el script
```bash
git clone https://github.com/aaccasanih-wq/gastosbot.git
cd gastosbot
clasp login
clasp create --type standalone --title "GastosBot"
clasp push
```

### 3. Configurar Script Properties
En el editor de Apps Script → Configuración del proyecto → Propiedades del script:

| Propiedad | Valor |
|---|---|
| `SPREADSHEET_ID` | ID de tu Google Spreadsheet |
| `TELEGRAM_TOKEN` | Token del bot de Telegram |
| `DEEPSEEK_API_KEY` | API key de DeepSeek |
| `GROQ_API_KEY` | API key de Groq |

### 4. Configurar la hoja de cálculo
La hoja debe llamarse `Registro_de_Gastos` y tener una pestaña `Config` con los familiares registrados.

### 5. Activar triggers
En Apps Script → Activadores, crear dos triggers **cada 1 minuto**:
- `pollTelegram` — recibe mensajes de Telegram
- `checkEmails` — procesa correos bancarios

## Bancos soportados (Perú)
- BCP (`notificaciones@notificacionesbcp.com.pe`)
- Yape (`notificaciones@yape.pe`)
- Interbank (`servicioalcliente@netinterbank.com.pe`)

## Costo estimado
Menos de **$0.05 USD / mes** en uso normal familiar.

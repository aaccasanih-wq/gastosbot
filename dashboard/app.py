import streamlit as st
import gspread
import pandas as pd
import plotly.express as px
from google.oauth2.service_account import Credentials

# ── Config ────────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="GastosBot Dashboard",
    page_icon="💸",
    layout="wide",
)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

COLS = ["id", "fecha", "pagador", "destinatario", "medio",
        "monto", "descripcion", "concepto", "fuente", "gmail_id"]

FAMILIARES = ["Axel", "Jansen"]

# ── Data loading ──────────────────────────────────────────────────────────────
@st.cache_data(ttl=300)
def load_data():
    creds = Credentials.from_service_account_info(
        st.secrets["gcp_service_account"], scopes=SCOPES
    )
    gc = gspread.authorize(creds)
    spreadsheet = gc.open_by_key(st.secrets["spreadsheet"]["id"])

    frames = []
    for familiar in FAMILIARES:
        try:
            ws = spreadsheet.worksheet(familiar)
            rows = ws.get_all_values()
            if len(rows) <= 1:
                continue
            df = pd.DataFrame(rows[1:], columns=COLS)
            df["familiar"] = familiar
            frames.append(df)
        except gspread.WorksheetNotFound:
            pass

    if not frames:
        return pd.DataFrame()

    df = pd.concat(frames, ignore_index=True)
    df["monto"] = pd.to_numeric(df["monto"], errors="coerce").fillna(0)
    df["fecha"] = pd.to_datetime(df["fecha"], errors="coerce")
    df = df.dropna(subset=["fecha"])
    df["mes"] = df["fecha"].dt.to_period("M").astype(str)
    return df

# ── Layout ────────────────────────────────────────────────────────────────────
st.title("💸 GastosBot Dashboard")
st.caption("Gastos familiares — actualizado cada 5 minutos")

with st.spinner("Cargando datos..."):
    df = load_data()

if df.empty:
    st.warning("No hay datos disponibles aún.")
    st.stop()

# ── Filtros sidebar ───────────────────────────────────────────────────────────
with st.sidebar:
    st.header("Filtros")

    familiares_disponibles = ["Todos"] + sorted(df["familiar"].unique().tolist())
    familiar_sel = st.selectbox("Familiar", familiares_disponibles)

    meses_disponibles = sorted(df["mes"].unique().tolist(), reverse=True)
    mes_sel = st.multiselect("Mes", meses_disponibles, default=meses_disponibles[:3])

    conceptos_disponibles = sorted(df["concepto"].dropna().unique().tolist())
    concepto_sel = st.multiselect("Concepto", conceptos_disponibles)

    if st.button("Limpiar caché"):
        st.cache_data.clear()
        st.rerun()

# Aplicar filtros
filtered = df.copy()
if familiar_sel != "Todos":
    filtered = filtered[filtered["familiar"] == familiar_sel]
if mes_sel:
    filtered = filtered[filtered["mes"].isin(mes_sel)]
if concepto_sel:
    filtered = filtered[filtered["concepto"].isin(concepto_sel)]

# ── KPIs ──────────────────────────────────────────────────────────────────────
col1, col2, col3, col4 = st.columns(4)
col1.metric("Total gastado", f"S/ {filtered['monto'].sum():,.2f}")
col2.metric("N° de registros", f"{len(filtered):,}")
col3.metric("Promedio por registro", f"S/ {filtered['monto'].mean():,.2f}" if len(filtered) else "—")
col4.metric("Meses mostrados", len(filtered["mes"].unique()))

st.divider()

# ── Gráficos ──────────────────────────────────────────────────────────────────
row1_col1, row1_col2 = st.columns(2)

with row1_col1:
    st.subheader("Gasto total por mes")
    by_mes = filtered.groupby("mes")["monto"].sum().reset_index().sort_values("mes")
    fig = px.bar(by_mes, x="mes", y="monto", labels={"mes": "Mes", "monto": "S/"}, color_discrete_sequence=["#4C9BE8"])
    fig.update_layout(xaxis_tickangle=-45)
    st.plotly_chart(fig, use_container_width=True)

with row1_col2:
    st.subheader("Distribución por concepto")
    by_concepto = filtered.groupby("concepto")["monto"].sum().reset_index()
    by_concepto = by_concepto[by_concepto["monto"] > 0]
    fig = px.pie(by_concepto, names="concepto", values="monto", hole=0.35)
    st.plotly_chart(fig, use_container_width=True)

row2_col1, row2_col2 = st.columns(2)

with row2_col1:
    st.subheader("Gasto por medio de pago")
    by_medio = filtered.groupby("medio")["monto"].sum().reset_index()
    by_medio = by_medio[by_medio["monto"] > 0]
    fig = px.bar(by_medio.sort_values("monto", ascending=True),
                 x="monto", y="medio", orientation="h",
                 labels={"monto": "S/", "medio": ""}, color_discrete_sequence=["#F4845F"])
    st.plotly_chart(fig, use_container_width=True)

with row2_col2:
    st.subheader("Evolución diaria")
    by_day = filtered.groupby("fecha")["monto"].sum().reset_index()
    fig = px.line(by_day, x="fecha", y="monto", labels={"fecha": "Fecha", "monto": "S/"})
    fig.update_traces(line_color="#5CB85C")
    st.plotly_chart(fig, use_container_width=True)

# Comparación familiar solo si hay ambos
if familiar_sel == "Todos" and df["familiar"].nunique() > 1:
    st.subheader("Comparación entre familiares por mes")
    comp = filtered.groupby(["mes", "familiar"])["monto"].sum().reset_index()
    fig = px.bar(comp, x="mes", y="monto", color="familiar", barmode="group",
                 labels={"mes": "Mes", "monto": "S/", "familiar": "Familiar"})
    fig.update_layout(xaxis_tickangle=-45)
    st.plotly_chart(fig, use_container_width=True)

st.subheader("Top 10 destinatarios")
top_benef = (
    filtered.groupby("destinatario")["monto"].sum()
    .reset_index()
    .sort_values("monto", ascending=False)
    .head(10)
)
fig = px.bar(top_benef, x="monto", y="destinatario", orientation="h",
             labels={"monto": "S/", "destinatario": ""},
             color_discrete_sequence=["#9B59B6"])
fig.update_layout(yaxis={"categoryorder": "total ascending"})
st.plotly_chart(fig, use_container_width=True)

# ── Tabla detalle ─────────────────────────────────────────────────────────────
with st.expander("Ver registros detallados"):
    st.dataframe(
        filtered[["fecha", "familiar", "destinatario", "medio", "monto", "concepto", "descripcion"]]
        .sort_values("fecha", ascending=False)
        .reset_index(drop=True),
        use_container_width=True,
    )

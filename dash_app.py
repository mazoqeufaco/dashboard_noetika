# dash_app.py
import base64, io, math
import pandas as pd
from dash import Dash, html, dcc, Input, Output, State, dash_table, callback_context
import plotly.graph_objects as go

app = Dash(__name__)
app.title = "Clique sobre o triângulo para definir sua prioridade"

def ternary_fig(r=1/3, g=1/3, b=1/3):
    # Plotly Ternary: a=Qualidade (topo), b=Prazo (direita), c=Custo (esquerda) por padrão.
    # Vamos mapear labels pra falar sua língua: Custo, Qualidade, Prazo.
    fig = go.Figure(go.Scatterternary(
        a=[g], b=[b], c=[r],  # mapeamento: a=Qualidade(g), b=Prazo(b), c=Custo(r)
        mode="markers",
        marker=dict(size=12, color="white", line=dict(width=2,color="black"))
    ))
    fig.update_layout(
        ternary=dict(
            sum=1,
            aaxis=dict(title="Qualidade", min=0),
            baxis=dict(title="Prazo", min=0),
            caxis=dict(title="Custo", min=0),
            bgcolor="black"
        ),
        plot_bgcolor="black",
        paper_bgcolor="#0b0b0b",
        font=dict(color="#eaeaea"),
        margin=dict(l=30, r=30, t=10, b=10),
        dragmode="pan",  # a interação de clique vamos capturar via clickData
    )
    return fig

app.layout = html.Div(style={"background":"#000","color":"#eaeaea","fontFamily":"Segoe UI, Arial"},
    children=[
        html.H3("Clique sobre o triângulo para definir sua prioridade", style={"textAlign":"center"}),

        dcc.Graph(id="tern", figure=ternary_fig(), clear_on_unhover=True, config={"displayModeBar":False},
                  style={"maxWidth":"720px","margin":"0 auto","background":"#000","border":"1px solid #222","borderRadius":"12px"}),

        html.Div(style={"display":"flex","gap":"12px","justifyContent":"center","alignItems":"center",
                        "background":"#151515","padding":"12px 16px","borderRadius":"12px","maxWidth":"980px","margin":"16px auto"},
                 children=[
            html.Label(["Custo", dcc.Input(id="cost", type="number", min=0, max=100, step=0.5, value=33.33,
                                           style={"width":"110px","fontWeight":"700"})], style={"display":"flex","gap":"8px","alignItems":"center"}),
            html.Label(["Qualidade", dcc.Input(id="qual", type="number", min=0, max=100, step=0.5, value=33.33,
                                               style={"width":"110px","fontWeight":"700"})]),
            html.Label(["Prazo", dcc.Input(id="time", type="number", min=0, max=100, step=0.5, value=33.33,
                                           style={"width":"110px","fontWeight":"700"})]),
            html.Button("Confirma", id="confirm", n_clicks=0,
                        style={"fontWeight":"800","padding":"10px 16px","borderRadius":"12px","background":"#21c999","color":"#071b14","border":"1px solid #17a97f"})
        ]),

        html.Div(style={"maxWidth":"980px","margin":"0 auto","padding":"12px","background":"#0e0e0e","border":"1px solid #222","borderRadius":"12px"},
                 children=[
            html.Label("CSV Zscores"),
            dcc.Upload(id="csv_up", children=html.Div(["Arraste/solte ou ", html.B("selecione um CSV")]),
                       style={"width":"100%","height":"60px","lineHeight":"60px","borderWidth":"1px","borderStyle":"dashed",
                              "borderRadius":"10px","textAlign":"center","borderColor":"#333","color":"#b8b8b8"}),
            html.Div(id="msg", style={"marginTop":"10px","whiteSpace":"pre-line"}),
            dash_table.DataTable(id="table",
                                 columns=[{"name":"id","id":"id"},
                                          {"name":"Zranking","id":"Zranking","type":"numeric","format":dict(specifier=".5f")},
                                          {"name":"s_Zrank","id":"s_Zrank","type":"numeric","format":dict(specifier=".5f")}],
                                 sort_action="native", page_size=12,
                                 style_header={"backgroundColor":"#151515","color":"#ddd","fontWeight":"700"},
                                 style_cell={"backgroundColor":"#0e0e0e","color":"#e6e6e6","border":"1px solid #1e1e1e",
                                             "fontFamily":"Segoe UI, Arial","fontSize":"14px"})
        ])
    ]
)

def normalize_triplet(c,q,t):
    s = max(c+q+t, 1e-12)
    return (100*c/s, 100*q/s, 100*t/s)

@app.callback(
    Output("cost","value"), Output("qual","value"), Output("time","value"), Output("tern","figure"),
    Input("tern","clickData"), Input("cost","value"), Input("qual","value"), Input("time","value")
)
def sync_weights(clickData, cost_v, qual_v, time_v):
    trig = [p["prop_id"] for p in callback_context.triggered][0] if callback_context.triggered else ""
    # Mapeamento ternário Plotly: ponto tem chaves 'a','b','c' (a=Qualidade, b=Prazo, c=Custo)
    if "tern.clickData" in trig and clickData:
        p = clickData["points"][0]
        g = float(p.get("a", 0.0))   # Qualidade
        b = float(p.get("b", 0.0))   # Prazo
        r = float(p.get("c", 0.0))   # Custo
        rP, gP, bP = normalize_triplet(r, g, b)
        fig = ternary_fig(rP/100, gP/100, bP/100)
        return rP, gP, bP, fig
    else:
        # Entrada manual → auto-balance proporcional
        rP = float(cost_v or 0.0); gP = float(qual_v or 0.0); bP = float(time_v or 0.0)
        s = rP + gP + bP
        if s <= 0: rP=gP=bP=33.3333
        else: rP, gP, bP = [x/s*100 for x in (rP,gP,bP)]
        fig = ternary_fig(rP/100, gP/100, bP/100)
        return rP, gP, bP, fig

def parse_contents(contents):
    # contents = "data:text/csv;base64,...."
    content_type, content_string = contents.split(',')
    decoded = base64.b64decode(content_string)
    return decoded.decode('utf-8', errors='ignore')

@app.callback(
    Output("table","data"), Output("msg","children"),
    Input("confirm","n_clicks"),
    State("cost","value"), State("qual","value"), State("time","value"),
    State("csv_up","contents")
)
def compute(n_clicks, rP, gP, bP, csv_contents):
    if not n_clicks:
        return [], ""
    if not csv_contents:
        return [], "Selecione o CSV antes de confirmar."

    # pesos puros 0..1
    r = (rP or 0)/100.0; g = (gP or 0)/100.0; b = (bP or 0)/100.0
    text = parse_contents(csv_contents)

    # tenta ; ou , e vírgula decimal
    try:
      df = pd.read_csv(io.StringIO(text), sep=None, engine="python")
    except Exception:
      df = pd.read_csv(io.StringIO(text), sep=';')

    # tenta mapear nomes (ajuste se os seus forem diferentes)
    # Esperados: ZCusto, ZQualidade, ZPrazo, s_Zcusto, s_ZQual, s_ZPrazo
    cols = {c.lower().replace(" ", ""): c for c in df.columns}
    def get_like(keys):
        for k in keys:
            if k in cols: return cols[k]
        raise KeyError(keys)
    ZC = get_like(["zcusto","zcost"])
    ZQ = get_like(["zqualidade","zqual","zquality"])
    ZP = get_like(["zprazo","zdeadline","ztime"])
    sC = get_like(["s_zcusto","szcusto","s_zcost"])
    sQ = get_like(["s_zqual","s_zqualidade","szqual"])
    sP = get_like(["s_zprazo","szprazo","s_ztime"])
    # id opcional
    ID = None
    for cand in ["id","nome","alternativa","opcao","item"]:
        if cand in cols: ID = cols[cand]; break

    # coerciona números (aceita vírgula)
    for c in [ZC,ZQ,ZP,sC,sQ,sP]:
        df[c] = (df[c].astype(str).str.replace(",", ".", regex=False)).astype(float)

    # Zranking e s_Zrank
    df["Zranking"] = (-r*df[ZC]) + (g*df[ZQ]) - (b*df[ZP])
    df["s_Zrank"]  = ((r*df[sC])**2 + (g*df[sQ])**2 + (b*df[sP])**2).pow(0.5)

    df["id"] = df[ID] if ID else range(1, len(df)+1)
    df = df.sort_values("Zranking", ascending=False)[["id","Zranking","s_Zrank"]]

    msg = (f"Suas prioridades de seleção da solução:\n\n"
           f"{r*100:.2f}% de peso para custo anual,\n"
           f"{g*100:.2f}% de qualidade (aderência a seus requisitos) e\n"
           f"{b*100:.2f}% para prazo.")

    return df.to_dict("records"), msg

if __name__ == "__main__":
    app.run(debug=True, port=8050)


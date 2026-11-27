import { describe, expect, it } from "vitest";
import {
  armarLaCartaEnLinea,
  type CartaEnLineaDeLaPantalla,
} from "../../apps/web/ui/plantillas/carta/modelo-de-carta-en-linea";

/**
 * El modelo de vista de «Carta en línea» (maqueta aprobada `carta-en-linea.html`): solo textos del catálogo, botones apagados sin permiso (todo lo que no sea exactamente `true` cierra),
 * «Poner en línea» apagado sin productos que salgan, los motivos solo si tienen cantidad y «No disponible» solo mientras la carta está fuera de línea.
 */
const CARTA = {
  id: "c-1",
  nombre: "Parador",
  rubro: "Parrilla",
  lugar: null,
  estado: "FUERA_DE_LINEA" as const,
  version: 3,
  cara: null,
  colorPropio: null,
  logo: null,
};
const dato = (extra: Partial<CartaEnLineaDeLaPantalla> = {}): CartaEnLineaDeLaPantalla => ({
  carta: CARTA,
  direccion: "https://app.ejemplo.test/CODIGO",
  qrSvg: "<svg/>",
  salen: 12,
  faltan: { sinPrecio: 2, sinSeccion: 0, desactivados: 1, ocultos: 4 },
  ...extra,
});
const TODO = { guardar: true, poner: true, sacar: true };

describe("armarLaCartaEnLinea", () => {
  it("fuera de línea: estado «Fuera de línea», botón «Poner en línea» activo con permiso y productos, y «No disponible» bajo la dirección", () => {
    const m = armarLaCartaEnLinea(dato(), TODO);
    expect(m.estado).toEqual({ enLinea: false, texto: "Fuera de línea" });
    expect(m.alternar).toEqual({
      estadoPedido: "EN_LINEA",
      texto: "Poner en línea",
      apagado: false,
    });
    expect(m.direccion).toMatchObject({
      titulo: "Dirección pública",
      copiar: "Copiar",
      copiado: "Enlace copiado",
      descargar: "Descargar QR",
      noDisponible: "No disponible",
    });
  });

  it("en línea: «En línea», «Sacar de línea» (pide FUERA_DE_LINEA) y sin «No disponible»; sacar no depende de que haya productos", () => {
    const m = armarLaCartaEnLinea(
      dato({ carta: { ...CARTA, estado: "EN_LINEA" }, salen: 0 }),
      TODO,
    );
    expect(m.estado).toEqual({ enLinea: true, texto: "En línea" });
    expect(m.alternar).toEqual({
      estadoPedido: "FUERA_DE_LINEA",
      texto: "Sacar de línea",
      apagado: false,
    });
    expect(m.direccion?.noDisponible).toBeNull();
  });

  it("sin permiso o sin ninguna señal (undefined) todo sale apagado; sin productos que salgan «Poner en línea» sale apagado", () => {
    expect(
      armarLaCartaEnLinea(dato(), { guardar: false, poner: false, sacar: false }).alternar?.apagado,
    ).toBe(true);
    expect(
      armarLaCartaEnLinea(dato(), { guardar: false, poner: false, sacar: false }).formulario
        .puedeGuardar,
    ).toBe(false);
    expect(armarLaCartaEnLinea(dato(), {} as never).formulario.puedeGuardar).toBe(false);
    expect(armarLaCartaEnLinea(dato({ salen: 0 }), TODO).alternar?.apagado).toBe(true);
    expect(
      armarLaCartaEnLinea(dato({ carta: { ...CARTA, estado: "EN_LINEA" } }), {
        ...TODO,
        sacar: false,
      }).alternar?.apagado,
    ).toBe(true);
  });

  it("el contador va en singular con uno y en plural con otro número; los motivos salen solo con cantidad", () => {
    expect(armarLaCartaEnLinea(dato({ salen: 1 }), TODO).contador).toBe("Sale 1 producto");
    expect(armarLaCartaEnLinea(dato({ salen: 0 }), TODO).contador).toBe("Salen 0 productos");
    expect(armarLaCartaEnLinea(dato(), TODO).contador).toBe("Salen 12 productos");
    expect(armarLaCartaEnLinea(dato(), TODO).motivos).toEqual([
      { texto: "Sin precio", cantidad: 2 },
      { texto: "Desactivado", cantidad: 1 },
      { texto: "Oculto", cantidad: 4 },
    ]);
  });

  it("sin carta: sin estado, sin botón de línea, sin dirección; el formulario sale vacío con los rótulos aprobados", () => {
    const m = armarLaCartaEnLinea(dato({ carta: null, direccion: null, qrSvg: null }), TODO);
    expect(m.estado).toBeNull();
    expect(m.alternar).toBeNull();
    expect(m.direccion).toBeNull();
    expect(m.formulario).toMatchObject({
      nombre: { etiqueta: "Nombre", valorInicial: "" },
      rubro: { etiqueta: "Rubro", valorInicial: "" },
      lugar: { etiqueta: "Lugar", valorInicial: "" },
      guardar: "Guardar",
    });
  });

  it("el modelo (DEC-CAT-004): Lista o Libro con sus textos; sin carta o con otro valor parte de Lista; con Libro guardado parte de Libro; sin permiso sale apagado", () => {
    const sin = armarLaCartaEnLinea(dato(), TODO).formulario.identidad;
    expect(sin.modelo.etiqueta).toBe("Modelo");
    expect(sin.modelo.opciones).toEqual([
      { valor: "LISTA", etiqueta: "Lista" },
      { valor: "LIBRO", etiqueta: "Libro" },
    ]);
    expect(sin.modelo.valorInicial).toBe("LISTA");
    for (const modelo of [null, "CUADRICULA", "inventado"]) {
      const m = armarLaCartaEnLinea(dato({ carta: { ...CARTA, modelo } }), TODO).formulario;
      expect(m.identidad.modelo.valorInicial, String(modelo)).toBe("LISTA");
    }
    const libro = armarLaCartaEnLinea(dato({ carta: { ...CARTA, modelo: "LIBRO" } }), TODO);
    expect(libro.formulario.identidad.modelo.valorInicial).toBe("LIBRO");
    const sinPermiso = armarLaCartaEnLinea(dato(), { ...TODO, guardar: false });
    expect(sinPermiso.formulario.identidad.apagada).toBe(true);
  });

  it("la identidad: sin elegir muestra la cara de siempre, «Usar lo de la empresa» y el logo vacío; con lo elegido, sus valores", () => {
    const sin = armarLaCartaEnLinea(dato(), TODO).formulario.identidad;
    expect(sin.cara.valorInicial).toBe("DIA");
    expect(sin.cara.opciones).toEqual([
      { valor: "DIA", etiqueta: "Día" },
      { valor: "BOLICHE", etiqueta: "Boliche" },
      { valor: "NOCHE", etiqueta: "Noche" },
    ]);
    expect(sin.color.valorInicial).toBe("");
    expect(sin.color.opciones.map((o) => o.etiqueta)).toEqual([
      "Usar lo de la empresa",
      "Azul",
      "Verde",
      "Bordó",
      "Tostado",
      "Negro",
      "Violeta",
      "Otro color",
    ]);
    expect(sin.color.opciones.map((o) => o.valor)).toEqual([
      "",
      "#1f4e79",
      "#17562f",
      "#7a1f2b",
      "#6b3f1d",
      "#1b1f24",
      "#4b2e83",
      "otro",
    ]);
    expect(sin.logo.direccion.valorInicial).toBe("");
    const LOGO = "https://res.cloudinary.com/demo/image/upload/v1/x.png";
    const con = armarLaCartaEnLinea(
      dato({ carta: { ...CARTA, cara: "NOCHE", colorPropio: "#17562f", logo: LOGO } }),
      TODO,
    ).formulario.identidad;
    expect(con.cara.valorInicial).toBe("NOCHE");
    expect(con.color.valorInicial).toBe("#17562f");
    expect(con.color.otro.valorInicial).toBe("");
    expect(con.logo.direccion.valorInicial).toBe(LOGO);
    const otro = armarLaCartaEnLinea(dato({ carta: { ...CARTA, colorPropio: "#0e7490" } }), TODO)
      .formulario.identidad.color;
    expect(otro.valorInicial).toBe("otro");
    expect(otro.otro.valorInicial).toBe("#0e7490");
  });

  it("los tres controles salen apagados sin permiso de editar: todo lo que no sea exactamente `true` cierra", () => {
    expect(armarLaCartaEnLinea(dato(), TODO).formulario.identidad.apagada).toBe(false);
    for (const oferta of [
      { ...TODO, guardar: false },
      { poner: true, sacar: true } as never,
      { ...TODO, guardar: undefined } as never,
      { ...TODO, guardar: "true" } as never,
      { ...TODO, guardar: 1 } as never,
    ])
      expect(armarLaCartaEnLinea(dato(), oferta).formulario.identidad.apagada).toBe(true);
  });

  it("los textos de la identidad son los del catálogo aprobado", () => {
    const { identidad } = armarLaCartaEnLinea(dato(), TODO).formulario;
    expect(identidad.cara.etiqueta).toBe("Cara");
    expect(identidad.color).toMatchObject({
      etiqueta: "Colores",
      colorInvalido: "Escribí el color como #0e7490",
      contrasteAviso: "El texto no se lee bien sobre este color",
      otro: { etiqueta: "Otro color" },
    });
    expect(identidad.logo).toMatchObject({
      etiqueta: "Logo",
      direccion: { etiqueta: "Dirección de la imagen" },
      quitar: "Quitar",
      direccionNoSirve: "La dirección no sirve",
    });
  });
});

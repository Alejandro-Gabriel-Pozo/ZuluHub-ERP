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
});

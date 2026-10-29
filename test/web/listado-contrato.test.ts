import { beforeAll, describe, expect, it } from "vitest";
import {
  FILTROS_POR_DEFECTO,
  RUTA_DEL_LISTADO,
} from "../../apps/web/ui/plantillas/facturacion/filtros-del-listado";
import {
  armarLaEleccionDeSucursal,
  armarElListado,
} from "../../apps/web/ui/plantillas/facturacion/modelo-del-listado";
import {
  PAGINA,
  pintar,
  propsDe,
  SUCURSALES,
  visible,
} from "../utilidades/listado-de-comprobantes";

/**
 * Contrato de la pantalla 1 (listado de comprobantes, 6A + 6C), en las dos direcciones: está todo lo que el contrato pide y no
 * aparece nada de lo que quedó afuera (Exportar D-3, Origen D-33, Pago D-23, Referencias, «+ Emitir», cantidad y total del
 * resultado D-32, ambiente y «acreditad» D-29).
 */

/** Lo que NO va en la pantalla, cada cosa con su decisión. */
const PROHIBIDOS: readonly (readonly [string, RegExp])[] = [
  ["Exportar (D-3)", /exportar/i],
  ["Origen (D-33)", /origen/i],
  ["Pago (D-23)", /\bpago\b|efectivo|tarjeta|transferencia|cuenta corriente/i],
  ["Referencias", /referencias/i],
  ["+ Emitir (la pantalla no existe)", /emitir|\+/i],
  ["Imprimir, mail, QR", /imprimir|mail|\bQR\b/i],
  ["«acreditad» (D-29)", /acreditad/i],
  ["ambiente o PRUEBAS", /ambiente|pruebas|homologaci/i],
  ["orígenes del prototipo", /mostrador|restaurante|hotel/i],
  ["cantidad del resultado (D-32)", /\b\d+\s+comprobantes\b/i],
  ["total del resultado (D-32)", /total\s*\$|\$\s*[\d.,]+\s*en total/i],
];

const prohibidosEn = (marcado: string): string[] => {
  const texto = visible(marcado);
  return PROHIBIDOS.filter(([, patron]) => patron.test(texto)).map(([nombre]) => nombre);
};

describe("prueba de contrato: lo que está", () => {
  let marcado = "";
  let texto = "";
  beforeAll(async () => {
    marcado = await pintar(propsDe());
    texto = visible(marcado);
  });

  it("los filtros del contrato: período, estado, letra, punto de venta y búsqueda", () => {
    for (const esperado of [
      "Período",
      "Hoy",
      "Últimos 7 días",
      "Este mes",
      "Todo",
      "Personalizado",
      "Estado",
      "Autorizada",
      "Validando",
      "Confirmando",
      "Rechazada",
      "Pendiente de enviar",
      "Requiere revisión",
      "Descartada",
      "Letra",
      "Todas",
      "Factura A",
      "Factura B",
      "Factura C",
      "Punto de venta",
      "00001",
      "00002",
      "Nombre o CUIT",
      "Todos",
    ]) {
      expect(texto, esperado).toContain(esperado);
    }
  });

  it("«Filtros (n)», «Limpiar» y el botón que aplica", () => {
    expect(texto).toContain("Filtros (0)");
    expect(texto).toContain("Limpiar");
    expect(texto).toContain("Ver comprobantes");
    expect(marcado).toContain(`href="${RUTA_DEL_LISTADO}"`);
  });

  it("los filtros son un formulario GET (anda sin JavaScript) con cada campo con su nombre", () => {
    const formulario = /<form[^>]*role="search"[^>]*>/.exec(marcado)?.[0] ?? "";
    expect(formulario).toContain('method="get"');
    expect(formulario).toContain('action="/facturacion/comprobantes"');
    for (const nombre of [
      "texto",
      "periodo",
      "desde",
      "hasta",
      "estado",
      "letra",
      "puntoDeVenta",
    ]) {
      expect(marcado, nombre).toContain(`name="${nombre}"`);
    }
  });

  it("la tabla tiene las columnas del contrato y cada fila, sus datos", () => {
    const columnas = [...marcado.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
    expect(columnas).toEqual(["Fecha", "Comprobante", "Cliente", "Documento", "Total", "Estado"]);
    for (const esperado of [
      "14/10/2026",
      "Factura B 00001-00001234",
      "Factura A",
      "Consumidor final",
      "Distribuidora Sur SA",
      "CUIT 30-71234567-8",
      "DNI 27.345.678",
      "$ 9.000,00",
      "$ 121.000,00",
      "Autorizada",
      "Validando",
      "Anulación parcial",
    ]) {
      expect(texto, esperado).toContain(esperado);
    }
  });

  it("los dos «Ver comprobantes» se distinguen: uno dentro del grupo «Sucursal», el otro en la búsqueda «Filtros (n)»", () => {
    expect(marcado).toMatch(/role="group"[^>]*aria-label="Sucursal"/);
    expect(marcado).toMatch(/role="search"[^>]*aria-label="Filtros \(0\)"/);
    const delGrupo = /aria-label="Sucursal">([\s\S]*?)<\/form>/.exec(marcado)?.[1] ?? "";
    expect(delGrupo).toContain("Ver comprobantes");
    expect(delGrupo).not.toContain('name="periodo"');
  });

  it("D-53: la tarjeta del celular lleva nombre, documento, número de comprobante y fecha", () => {
    const tarjetas = /<ul[^>]*>([\s\S]*?)<\/ul>/.exec(marcado)?.[1] ?? "";
    const delCliente = visible(tarjetas);
    for (const esperado of [
      "Distribuidora Sur SA",
      "CUIT 30-71234567-8",
      "Factura A",
      "13/10/2026",
      "Juan Pérez",
      "DNI 27.345.678",
      "Factura B 00001-00001234",
      "14/10/2026",
    ]) {
      expect(delCliente, esperado).toContain(esperado);
    }
  });

  it("tocar una fila (tarjeta o tabla) abre el detalle con un enlace real", () => {
    const enlaces = [
      ...marcado.matchAll(/<a[^>]*href="(\/facturacion\/comprobantes\/[^"]+)"/g),
    ].map((m) => m[1]);
    const ids = PAGINA.items.map((i) => `/facturacion/comprobantes/${i.id}`);
    // Una vez en la tarjeta y otra en la tabla.
    expect(enlaces.sort()).toEqual([...ids, ...ids].sort());
  });

  it("«Página siguiente» solo cuando hay otra página, con la clave en la dirección", async () => {
    expect(texto).toContain("Página siguiente");
    expect(marcado).toMatch(
      /<a[^>]*href="\/facturacion\/comprobantes\?despues=[^"]+"[^>]*>Página siguiente/,
    );
    const ultima = await pintar(propsDe({ pagina: { ...PAGINA, siguiente: null } }));
    expect(visible(ultima)).not.toContain("Página siguiente");
  });

  it("el selector de sucursal con la cerrada marcada (D-37)", () => {
    expect(texto).toContain("Sucursal");
    expect(texto).toContain("Centro");
    expect(texto).toContain("Norte · Cerrada");
    expect(marcado).toContain('name="sucursalId"');
  });

  it("sin comprobantes: el texto de vacío y ninguna fila", async () => {
    const vacio = await pintar(propsDe({ pagina: { items: [], siguiente: null } }));
    expect(visible(vacio)).toContain(
      "No hay comprobantes con esos filtros. Probá con otro período o tocá «Limpiar».",
    );
    expect(vacio).not.toContain("<table");
    expect(vacio).not.toContain('<ul class="');
  });

  it("sin sucursal elegida: la invitación y el selector, sin filtros ni lista (D-36)", async () => {
    const sinElegir = await pintar(
      propsDe(
        {},
        {
          eleccionDeSucursal: armarLaEleccionDeSucursal(SUCURSALES, ""),
          filtros: null,
          listado: null,
        },
      ),
    );
    expect(visible(sinElegir)).toContain("Elegí una sucursal para ver sus comprobantes.");
    expect(sinElegir).toContain('name="sucursalId"');
    // El selector en blanco es obligatorio: el navegador no deja enviarlo sin elegir.
    expect(/<select[^>]*>/.exec(sinElegir)?.[0]).toContain("required");
    expect(sinElegir).not.toContain('name="periodo"');
    expect(sinElegir).not.toContain("<table");
  });
});

describe("prueba de contrato: lo que no está", () => {
  const variantes = {
    "con filas": propsDe(),
    "con filtros activos": propsDe({
      filtros: {
        ...FILTROS_POR_DEFECTO,
        periodo: "personalizado",
        estado: "RECHAZADO",
        letra: "A",
      },
    }),
    "sin filas": propsDe({ pagina: { items: [], siguiente: null } }),
    "sin selector de sucursal": propsDe({}, { eleccionDeSucursal: null }),
  };

  it.each(Object.entries(variantes))("%s: nada de lo que quedó afuera", async (_nombre, props) => {
    const marcado = await pintar(props);
    expect(prohibidosEn(marcado)).toEqual([]);
    expect(marcado).not.toMatch(/<h1\b/);
    expect(marcado).not.toMatch(/\sstyle=/);
  });

  it("«Total» solo aparece como columna, no como cifra del resultado", async () => {
    const marcado = await pintar(propsDe());
    const fuera = marcado.replace(/<th[^>]*>Total<\/th>/g, "");
    expect(visible(fuera)).not.toMatch(/\bTotal\b/);
  });

  it("la tabla no tiene columna de punto de venta (el listado no trae ese dato como campo)", async () => {
    const columnas = [...(await pintar(propsDe())).matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(
      (m) => m[1],
    );
    expect(columnas).not.toContain("Punto de venta");
  });

  it("la fila no trae botones: solo enlaces (tocar abre el detalle, sin confirmar nada)", async () => {
    const filas = (await pintar(propsDe())).split("<table")[1] ?? "";
    expect(filas).not.toMatch(/<(button|input|select|form)\b/);
  });

  it("sin comprobantes, sin selector ni «Página siguiente»", () => {
    const m = armarElListado({ items: [], siguiente: null }, FILTROS_POR_DEFECTO);
    expect(m.siguiente).toBeNull();
    expect(armarLaEleccionDeSucursal([], "")).toBeNull();
  });

  describe("el detector (violación inyectada)", () => {
    it.each([
      ["Exportar (D-3)", "<button>Exportar</button>"],
      ["Origen (D-33)", "<th>Origen</th>"],
      ["Pago (D-23)", "<th>Pago</th>"],
      ["Referencias", "<th>Referencias</th>"],
      ["+ Emitir (la pantalla no existe)", "<a>+ Emitir</a>"],
      ["Imprimir, mail, QR", "<button>Imprimir</button>"],
      ["«acreditad» (D-29)", "<span>Acreditada parcialmente</span>"],
      ["cantidad del resultado (D-32)", "<p>42 comprobantes</p>"],
      ["total del resultado (D-32)", "<p>Total $ 1.000,00</p>"],
    ])("marca %s", async (nombre, inyectado) => {
      expect(prohibidosEn((await pintar(propsDe())) + inyectado)).toContain(nombre);
    });
  });
});

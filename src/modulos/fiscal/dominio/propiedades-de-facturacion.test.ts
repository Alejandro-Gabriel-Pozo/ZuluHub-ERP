import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  facturaOSinTotal,
  fecha,
  receptorInscripto,
  renglonArbitrario,
} from "../../../../test/utilidades/facturacion";
import { EMPRESA } from "../../../../test/utilidades/fiscal";
import { importeDesdeTexto, sumar } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { porcentajeDeAlicuota } from "./alicuota";
import { calcularRenglones, MODOS_DE_PRECIO } from "./calculo-de-renglones";
import { CODIGO_DE_TIPO_DE_COMPROBANTE, CODIGO_DE_TIPO_DE_DOCUMENTO } from "./codigos-de-arca";
import { letraDeComprobante, type TipoDeComprobante } from "./comprobante-emitido";
import type { RenglonAFacturar } from "./comprobante-nuevo";
import { CONDICIONES_DE_IVA } from "./emisor";
import { solicitudId } from "./identificadores";
import { importesParaArca } from "./importes-para-arca";
import { modeloDeImpresion, VERSION_DE_REPRESENTACION_ACTUAL } from "./modelo-de-impresion";
import { armarNotaAsociada, type ComprobanteAAsociar } from "./nota-asociada";
import { numeroDeDocumentoParaArca } from "./receptor";
import { coincideConLoRegistrado } from "./reconciliacion-de-comprobante";
import { POLITICA_VIGENTE } from "../../../primitivas/dinero/redondeo";

/**
 * Propiedades del dominio de facturación como conjunto (spec H7 facturación §D, «Propiedades del
 * cálculo»). Las que viven en un solo archivo están junto a su prueba; acá están las que cruzan
 * archivos.
 */

const renglones = fc.array(renglonArbitrario(), { minLength: 1, maxLength: 8 });

/**
 * Oráculo independiente de `calcularRenglones`: todo en enteros con un denominador común.
 * precio (10⁶) × cantidad (10⁴) × (1 − descuento) (10⁶) × (1 + alícuota) (10⁶) × 100 centavos.
 */
const DENOMINADOR = 10n ** 22n;
function totalDeReferencia(
  rs: readonly RenglonAFacturar[],
  modo: "IVA_INCLUIDO" | "IVA_DISCRIMINADO",
) {
  let suma = 0n;
  for (const r of rs) {
    const descuento = r.descuento?.unidades ?? 0n;
    const alicuota =
      modo === "IVA_DISCRIMINADO" && r.alicuota !== null
        ? (porcentajeDeAlicuota(r.alicuota)?.unidades ?? 0n)
        : 0n;
    suma +=
      r.precioUnitario.unidades *
      r.cantidad.unidades *
      (10n ** 6n - descuento) *
      (10n ** 6n + alicuota) *
      100n;
  }
  return (suma * 2n + DENOMINADOR) / (2n * DENOMINADOR); // la mitad sube (suma ≥ 0)
}

describe("el total se redondea una sola vez, la mitad sube (decisiones 8 y 9)", () => {
  it("total = redondear(Σ renglones exactos), en los dos modos de precio", () => {
    fc.assert(
      fc.property(renglones, fc.constantFrom(...MODOS_DE_PRECIO), (rs, modo) => {
        const r = calcularRenglones(ARS, rs, modo, POLITICA_VIGENTE);
        const esperado = totalDeReferencia(rs, modo);
        if (esperado === 0n) {
          expect(r.ok).toBe(false);
          return;
        }
        expect(r.ok && r.valor.total.unidades).toBe(esperado);
      }),
    );
  });
});

describe("la nota hereda la letra del asociado y es positiva", () => {
  const tipoAsociable = fc.constantFrom<TipoDeComprobante>(
    "FACTURA_A",
    "FACTURA_B",
    "FACTURA_C",
    "NOTA_DEBITO_A",
    "NOTA_DEBITO_B",
    "NOTA_DEBITO_C",
  );

  it("para cualquier asociado autorizado, emisor de hoy y renglones", () => {
    fc.assert(
      fc.property(
        tipoAsociable,
        fc.constantFrom(...CONDICIONES_DE_IVA),
        fc.constantFrom("NOTA_CREDITO", "NOTA_DEBITO"),
        fc.constantFrom("IVA_INCLUIDO", "IVA_DISCRIMINADO"),
        fc.array(renglonArbitrario(), { minLength: 1, maxLength: 5 }),
        (tipo, condicionDeHoy, clase, modoDePrecio, rs) => {
          const letra = letraDeComprobante(tipo);
          const asociado: ComprobanteAAsociar = {
            empresaId: EMPRESA,
            emisorId: contextoDeEmision().emisorId,
            ambiente: "HOMOLOGACION",
            tipo,
            estado: "AUTORIZADO",
            numero: 5n,
            fechaEmision: fecha("2026-10-01"),
            emisor: emisorInstantaneo(),
            receptor: letra === "A" ? receptorInscripto : consumidorFinal,
          };
          const r = armarNotaAsociada(
            asociado,
            {
              clase,
              motivo: null,
              modoDePrecio,
              concepto: "PRODUCTOS",
              servicio: null,
              renglones: rs.map((x) => ({
                ...x,
                alicuota: letra === "C" ? null : (x.alicuota ?? "21"),
              })),
            },
            contextoDeEmision({ emisor: emisorInstantaneo({ condicionIva: condicionDeHoy }) }),
          );
          if (!r.ok) {
            // los únicos errores posibles son el modo de precio en C y un total en cero
            expect(["MODO_DE_PRECIO_INVALIDO_PARA_C", "TOTAL_FUERA_DE_RANGO"]).toContain(
              r.error.codigo,
            );
            return;
          }
          expect(letraDeComprobante(r.valor.tipo)).toBe(letra);
          expect(r.valor.receptor).toBe(asociado.receptor);
          expect(r.valor.total.unidades > 0n).toBe(true);
          expect(r.valor.neto.unidades >= 0n && r.valor.iva.unidades >= 0n).toBe(true);
        },
      ),
    );
  });
});

describe("lo que se arma, se envía y se imprime es coherente", () => {
  it("el comprobante coincide con lo que ARCA devolvería de sus propios importes", () => {
    fc.assert(
      fc.property(
        renglones,
        fc.constantFrom(consumidorFinal, receptorInscripto),
        fc.constantFrom(...MODOS_DE_PRECIO),
        (rs, receptor, modoDePrecio) => {
          const contenido = facturaOSinTotal(receptor, rs, { modoDePrecio });
          if (contenido === null) return;
          const i = importesParaArca(contenido);
          const enVuelo = {
            solicitud: solicitudId("sol-1"),
            numero: 7n,
            fecha: fecha("2026-10-13"),
            contenido,
          };
          const registrado = {
            tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE[contenido.tipo],
            puntoDeVenta: contenido.emisor.puntoDeVentaNumero,
            numero: 7n,
            fecha: fecha("2026-10-13"),
            tipoDeDocumento: CODIGO_DE_TIPO_DE_DOCUMENTO[contenido.receptor.documento.tipo],
            numeroDeDocumento: numeroDeDocumentoParaArca(contenido.receptor.documento),
            moneda: "PES",
            total: i.total,
            neto: i.neto,
            iva: i.iva,
            alicuotas: i.alicuotas,
            asociado: null,
          };
          expect(coincideConLoRegistrado(enVuelo, registrado)).toBe(true);
          // y si ARCA tuviera un centavo más, ya no es el nuestro
          const conUnCentavoMas = {
            ...registrado,
            total: sumar(i.total, importeDesdeTexto(ARS, "0.01")),
          };
          expect(coincideConLoRegistrado(enVuelo, conUnCentavoMas)).toBe(false);
        },
      ),
    );
  });

  it("el QR dice el mismo total que el comprobante, en centavos exactos", () => {
    fc.assert(
      fc.property(renglones, (rs) => {
        const contenido = facturaOSinTotal(consumidorFinal, rs);
        if (contenido === null) return;
        const m = modeloDeImpresion(
          {
            contenido,
            numero: 1n,
            fechaEmision: fecha("2026-10-13"),
            cae: "70417054367476",
            caeVence: fecha("2026-10-23"),
            versionDeRepresentacion: VERSION_DE_REPRESENTACION_ACTUAL,
            datosFiscales: {
              iibbNumero: null,
              iibbCondicion: null,
              inicioDeActividades: fecha("2019-03-01"),
            },
          },
          { nombreDeFantasia: null, logoUrl: null, colorPrincipal: null },
        );
        expect(m.ok).toBe(true);
        if (!m.ok) return;
        const json = atob(m.valor.qr.url.slice(m.valor.qr.url.indexOf("?p=") + 3));
        const importe = /"importe":([0-9.]+),/.exec(json)?.[1] ?? "";
        const [enteros = "", decimales = ""] = importe.split(".");
        const centavos = BigInt(enteros) * 100n + BigInt(decimales.padEnd(2, "0"));
        expect(centavos).toBe(contenido.total.unidades);
      }),
    );
  });
});

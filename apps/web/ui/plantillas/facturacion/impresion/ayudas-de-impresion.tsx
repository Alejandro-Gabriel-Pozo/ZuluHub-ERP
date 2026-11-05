import type { ComprobanteParaLaHoja } from "./modelo-de-la-hoja";

/** Apoyo de las pruebas en Chromium de la vista imprimible: comprobantes de prueba y espera de las hojas. No es una prueba. */

export const QR_DE_PRUEBA =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#000"/><rect x="2" y="2" width="6" height="6" fill="#fff"/></svg>';

const aTexto = (centavos: bigint): string => {
  const s = String(centavos).padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};

/** 200 caracteres justos, con espacios, como el renglón más largo que admite el comprobante. */
const DESCRIPCION_DE_200 =
  "Pan de campo artesanal de masa madre con semillas y frutos secos, horneado en el día y entregado en caja individual con tarjeta personalizada para la empresa, incluye servicio de entrega y retiro de envases, sin cargo".slice(
    0,
    200,
  );

export type OpcionesDelComprobante = Readonly<{
  letra?: "A" | "B" | "C";
  renglones?: number;
  /** Cada tercer renglón lleva una descripción de 200 caracteres. */
  descripcionesLargas?: boolean;
  consumidorFinal?: boolean;
  notaDeCredito?: boolean;
  /** Las leyendas del modelo, tal cual; sin esto, el comprobante no lleva ninguna. */
  leyendas?: readonly string[];
  /** Los textos legales del modelo, tal cual; sin esto, el comprobante no trae la clave. */
  leyendasLegales?: readonly string[];
  contacto?: boolean;
}>;

/** Un comprobante de prueba con importes que suman el total (como los de fiscal): se arma a mano, sin pasar por el dominio. */
export function comprobanteDePrueba(o: OpcionesDelComprobante = {}): ComprobanteParaLaHoja {
  const letra = o.letra ?? "B";
  const cantidad = o.renglones ?? 8;
  const renglones = Array.from({ length: cantidad }, (_, i) => {
    const importe = BigInt(150_000 + i * 1_234);
    return {
      descripcion:
        o.descripcionesLargas === true && i % 3 === 0 ? DESCRIPCION_DE_200 : `Artículo ${i + 1}`,
      cantidad: "1.0000",
      precioUnitario: `${aTexto(importe)}0000`,
      alicuota: letra === "C" ? null : "21",
      importe: aTexto(importe),
    };
  });
  const totalEnCentavos = renglones.reduce((a, r) => a + BigInt(r.importe.replace(".", "")), 0n);
  const netoEnCentavos = (totalEnCentavos * 100n) / 121n;
  const ivaEnCentavos = totalEnCentavos - netoEnCentavos;
  const total = aTexto(totalEnCentavos);
  const esFinal = o.consumidorFinal ?? letra !== "A";
  return {
    marca: { nombreDeFantasia: "La Panadería de Zulu" },
    fiscal: {
      rotulo: o.notaDeCredito === true ? "NOTA DE CRÉDITO" : "FACTURA",
      letra,
      codigoDelTipo: { A: "001", B: "006", C: "011" }[letra],
      numero: "00001-00000011",
      fecha: "2026-10-13",
      cae: "70417054367476",
      caeVence: "2026-10-23",
      emisor: {
        cuit: "30-70853393-5",
        razonSocial: "Panadería Zulu SRL",
        condicionIva: letra === "C" ? "MONOTRIBUTO" : "RESPONSABLE_INSCRIPTO",
        domicilioFiscal: "Av. Corrientes 1234, Ciudad Autónoma de Buenos Aires (CP C1043)",
        domicilioDelPuntoDeVenta: "Calle Falsa 123, Ciudad Autónoma de Buenos Aires (CP C1043)",
        iibbNumero: "901-123456-7",
        inicioDeActividades: "2019-03-01",
      },
    },
    receptor: esFinal
      ? {
          nombre: null,
          documento: { tipo: "SIN_IDENTIFICAR" },
          condicionIva: "CONSUMIDOR_FINAL",
          domicilio: null,
          leyenda: "A CONSUMIDOR FINAL",
        }
      : {
          nombre: "Distribuidora Sur SA",
          documento: { tipo: "CUIT", numero: "30712345678" },
          condicionIva: "RESPONSABLE_INSCRIPTO",
          domicilio: "Av. Siempreviva 742",
        },
    renglones,
    totales:
      letra === "A"
        ? {
            letra,
            netoPorAlicuota: [
              { alicuota: "21", neto: aTexto(netoEnCentavos), iva: aTexto(ivaEnCentavos) },
            ],
            exento: "0.00",
            noGravado: "0.00",
            total,
          }
        : { letra, total },
    ...(letra === "B" && esFinal
      ? {
          transparenciaFiscal: {
            titulo: {
              a4: "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)",
              rollo80mm: "TRANSPARENCIA FISCAL",
            },
            ivaContenido: {
              rotulo: "IVA Contenido",
              porAlicuota: [{ alicuota: "21", iva: aTexto(ivaEnCentavos) }],
            },
            otrosImpuestosNacionalesIndirectos: {
              rotulo: "Otros Impuestos Nacionales Indirectos",
              valor: "0.00",
            },
          },
        }
      : {}),
    ...(o.contacto === true
      ? {
          contacto: {
            telefono: "011 5555-0100",
            correo: "hola@zulu.example",
            web: { texto: "www.zulu.example", enlace: "https://www.zulu.example" },
          },
        }
      : {}),
    asociado:
      o.notaDeCredito === true
        ? { rotulo: "FACTURA", letra, numero: "00001-00000007", fecha: "2026-10-01" }
        : null,
    leyendas: o.leyendas ?? [],
    ...(o.leyendasLegales === undefined ? {} : { leyendasLegales: o.leyendasLegales }),
  };
}

/** Espera a que las hojas estén dibujadas y quietas (la medición puede repetirse cuando terminan de cargar las fuentes). */
export async function esperarLasHojas(): Promise<HTMLElement[]> {
  let ultimo = -1;
  for (let intento = 0; intento < 60; intento += 1) {
    await new Promise((resolver) => setTimeout(resolver, 80));
    const hojas = [...document.querySelectorAll<HTMLElement>("[data-hoja]")];
    if (hojas.length > 0 && hojas.length === ultimo) return hojas;
    ultimo = hojas.length;
  }
  throw new Error("las hojas no aparecieron o no se estabilizaron");
}

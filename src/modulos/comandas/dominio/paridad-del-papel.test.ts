import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  documentoDeAnulacion,
  documentoDeComanda,
  type AvisoParaElPapel,
  type EnvioParaElPapel,
  type RenglonDelPapel,
} from "./documento";

/**
 * PARIDAD BYTE A BYTE del papel de COMANDA y de ANULACIÓN (K6: el maquetado compartido se mudó a `src/primitivas/papel/`; la comanda no puede cambiar ni un
 * carácter). Cada caso es una entrada fija y el sha256 de su salida serializada, calculado con el código de ANTES de la mudanza (`d3cb117`). Si una de
 * estas huellas cambia, el papel de la cocina cambió. Previene: que mover el maquetado altere una comanda ya impresa o su reimpresión.
 */

const huella = (valor: unknown): string =>
  createHash("sha256").update(JSON.stringify(valor)).digest("hex");

const envio = (cambios: Partial<EnvioParaElPapel> = {}): EnvioParaElPapel => ({
  numero: 7,
  tipo: "ENVIO",
  rotulo: "Mesa 5",
  enviadoEn: "15/11/2026 21:30",
  tomadoPor: "lucia@ejemplo.com",
  ...cambios,
});
const renglon = (cambios: Partial<RenglonDelPapel> = {}): RenglonDelPapel => ({
  cantidad: "2",
  unidadDeVenta: "UNIDAD",
  paso: "1",
  nombreDeCocina: "Milanesa napolitana",
  detalle: ["Grande", "Sin cebolla", "Con papas fritas y huevo a caballo extra crocante"],
  rol: "SALE",
  ...cambios,
});
const aviso = (cambios: Partial<AvisoParaElPapel> = {}): AvisoParaElPapel => ({
  rotulo: "Mesa 5",
  envioNumero: 7,
  enviadoEn: "15/11/2026 21:30",
  anuladoPor: "lucia@ejemplo.com",
  cantidadAnulada: "1",
  quedan: "1",
  unidadDeVenta: "UNIDAD",
  paso: "1",
  nombreDeCocina: "Milanesa napolitana",
  detalle: ["Grande", "Sin cebolla"],
  motivo: "El cliente se arrepintió",
  ...cambios,
});

const CASOS: Readonly<Record<string, () => unknown>> = {};
const sumar = (nombre: string, f: () => unknown) => {
  (CASOS as Record<string, () => unknown>)[nombre] = f;
};
for (const ancho of [58, 80] as const) {
  for (const copia of [false, true]) {
    const o = { copia, ancho };
    sumar(`comanda ${ancho} copia=${copia}`, () => documentoDeComanda(envio(), [renglon()], o));
    sumar(`comanda salida pedida ${ancho} copia=${copia}`, () =>
      documentoDeComanda(envio({ tipo: "SALIDA_PEDIDA" }), [renglon({ rol: "ESPERA" })], o),
    );
    sumar(`comanda varios renglones ${ancho} copia=${copia}`, () =>
      documentoDeComanda(
        envio({ rotulo: "Mesa 12 del patio exterior junto a la ventana grande" }),
        [
          renglon(),
          renglon({ cantidad: "0.5", nombreDeCocina: "Pizza muzzarella", detalle: [] }),
          renglon({ cantidad: "1.5", nombreDeCocina: "Pizza", detalle: ["Mitad fugazzeta"] }),
          renglon({
            cantidad: "350",
            unidadDeVenta: "GRAMO",
            paso: "50",
            nombreDeCocina: "Queso",
            detalle: [],
          }),
          renglon({
            cantidad: "0.25",
            nombreDeCocina: "Empanada",
            detalle: ["Carne"],
            rol: "ESPERA",
          }),
          renglon({
            nombreDeCocina: "SuperlargoNombreSinEspaciosQueNoEntraEnElAnchoDelPapel".repeat(2),
            detalle: [],
          }),
        ],
        o,
      ),
    );
    sumar(`comanda cantidad no imprimible ${ancho} copia=${copia}`, () =>
      documentoDeComanda(envio(), [renglon({ cantidad: "0.3333" })], o),
    );
    sumar(`anulacion ${ancho} copia=${copia}`, () => documentoDeAnulacion(aviso(), o));
    sumar(`anulacion entera ${ancho} copia=${copia}`, () =>
      documentoDeAnulacion(aviso({ quedan: "0", cantidadAnulada: "2" }), o),
    );
    sumar(`anulacion fraccion ${ancho} copia=${copia}`, () =>
      documentoDeAnulacion(aviso({ cantidadAnulada: "0.5", quedan: "1.5", detalle: [] }), o),
    );
    sumar(`anulacion mal ${ancho} copia=${copia}`, () =>
      documentoDeAnulacion(aviso({ quedan: "x" }), o),
    );
  }
}

const ESPERADAS: Readonly<Record<string, string>> = {
  "comanda 58 copia=false": "b29c1b8fbe06687d4e784c0095c77ccecb8b42d8d1a9ed41ad923fb6e8ded376",
  "comanda salida pedida 58 copia=false":
    "aa6b25141f65f5847ce2313bdba96537d0c715a51f8e1cea074ee346a1fd738b",
  "comanda varios renglones 58 copia=false":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "comanda cantidad no imprimible 58 copia=false":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "anulacion 58 copia=false": "607bd0614736ba582d74e2e84c54d1ee286386ab88f9c84771d453301aa75eab",
  "anulacion entera 58 copia=false":
    "6b68acd8383f68263dfd4702929407d43af0742b9bf8cd15b14ad43b9e07ebdb",
  "anulacion fraccion 58 copia=false":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "anulacion mal 58 copia=false":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "comanda 58 copia=true": "3b6f679eb786a19b87207de263c655207a034d02c239a1394655536f7c387213",
  "comanda salida pedida 58 copia=true":
    "049593ea8112299bcc1a48382ed063709215049aa161ebdffb9a83fc4542be45",
  "comanda varios renglones 58 copia=true":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "comanda cantidad no imprimible 58 copia=true":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "anulacion 58 copia=true": "3e0f5593538f8eac9cadfafc43d4740f9b3997c737183e2ce841056c9885a975",
  "anulacion entera 58 copia=true":
    "b56ccc6522f6c3b96e8f9b3d1f35997dea1e86831d569575829c253e25fc58b8",
  "anulacion fraccion 58 copia=true":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "anulacion mal 58 copia=true": "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "comanda 80 copia=false": "7b1b8a98731ea57586ebe5e50b53f00e2370c961d0ab95819bd1dc5884c39fb2",
  "comanda salida pedida 80 copia=false":
    "81fd47b007160da76e57577a484021231c5c7d3af06aa7093b98c733505078fe",
  "comanda varios renglones 80 copia=false":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "comanda cantidad no imprimible 80 copia=false":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "anulacion 80 copia=false": "a7ef2e4412fb6d89e7fd2f08935c30e4e505a2df13d2337f66737a74991a209d",
  "anulacion entera 80 copia=false":
    "fb1d5b9dab7cfca3fc362e4fe89be008c000725e084ddd36b52b690f436ec2cf",
  "anulacion fraccion 80 copia=false":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "anulacion mal 80 copia=false":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "comanda 80 copia=true": "4fc898ba9560ee6720bd3d8d3001fe0375c4083b70d0cf659bffab4fda74c792",
  "comanda salida pedida 80 copia=true":
    "2eb3cb4bb9f0c19ea0ec3a2712deb4d70432d53eaefc68672d9c2a48e058c861",
  "comanda varios renglones 80 copia=true":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "comanda cantidad no imprimible 80 copia=true":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "anulacion 80 copia=true": "b0ec53b14236ad97f2db6ee2dbf4a0ec181c8252c9ee0260c36e2c0ca48c7f28",
  "anulacion entera 80 copia=true":
    "0dc802e277d9eb52278b28c0dfaf1ce8d11f3bf9bd9df040c043a29ede3c4582",
  "anulacion fraccion 80 copia=true":
    "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
  "anulacion mal 80 copia=true": "1e620607c85879cb1a324c161f5126ae14d404adbe875fc98ea9a3ecad4c6181",
};

describe("paridad byte a byte de la comanda y la anulación", () => {
  it("las entradas fijas cubren los casos esperados (ni uno de más ni uno de menos)", () => {
    expect(Object.keys(CASOS).sort()).toEqual(Object.keys(ESPERADAS).sort());
  });
  it.each(Object.keys(ESPERADAS))(
    "%s sale idéntico al papel de antes de mudar el maquetado",
    (nombre) => {
      expect(huella((CASOS[nombre] as () => unknown)())).toBe(ESPERADAS[nombre]);
    },
  );
});

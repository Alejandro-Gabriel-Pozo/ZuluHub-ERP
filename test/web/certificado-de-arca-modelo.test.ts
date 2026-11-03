import { describe, expect, it } from "vitest";
import { aCertificadoParaMostrar } from "../../apps/web/pantallas/certificado";
import {
  ambienteDelSegmento,
  armarElAmbiente,
  armarElPedidoDeCertificado,
  armarLaCargaDeCertificado,
  armarLaListaDeAmbientes,
  lugarDelErrorDeLaCarga,
  lugarDelErrorDelPedido,
  nombreDelArchivoDelPedido,
  rutaDelCertificadoDe,
  type CertificadoParaMostrar,
} from "../../apps/web/ui/plantillas/configuracion-fiscal/modelo-de-certificado";

/**
 * El modelo de la pantalla «Certificado de ARCA» (opción B): la lista por ambiente (Pruebas primero), desde qué paso arranca cada estado,
 * el vencimiento como fecha civil de Argentina (dd/mm/aaaa, sin días ni «por vencer») y los dos pedidos al servidor.
 */
const CUIT = "20123456786";
const vigente = (cambios: Record<string, unknown> = {}): CertificadoParaMostrar => ({
  ambiente: "HOMOLOGACION",
  situacion: "VIGENTE",
  alias: "pedernalprueba",
  cuitTitular: CUIT,
  vence: "2028-10-12",
  vencido: false,
  ...cambios,
});
const pendiente: CertificadoParaMostrar = {
  ambiente: "PRODUCCION",
  situacion: "PEDIDO_GENERADO",
  certificadoId: "id-del-pedido",
  alias: "pedernalprod",
  cuitTitular: CUIT,
};

describe("la lista de ambientes", () => {
  it("una fila por ambiente, Pruebas primero, cada una a su dirección", () => {
    const filas = armarLaListaDeAmbientes([]);
    expect(filas.map((f) => [f.titulo, f.href])).toEqual([
      ["Pruebas", "/configuracion-fiscal/certificado-de-arca/pruebas"],
      ["Producción", "/configuracion-fiscal/certificado-de-arca/produccion"],
    ]);
  });

  it("los carteles aprobados: Falta cargar, Pendiente, Vencido; el vigente no lleva cartel", () => {
    const carteles = (certificados: readonly CertificadoParaMostrar[]) =>
      armarLaListaDeAmbientes(certificados).map((f) => f.cartel?.texto ?? null);
    expect(carteles([])).toEqual(["Falta cargar", "Falta cargar"]);
    expect(carteles([vigente(), pendiente])).toEqual([null, "Pendiente"]);
    expect(carteles([vigente({ vencido: true })])).toEqual(["Vencido", "Falta cargar"]);
  });

  it("el vigente dice «Vence» y la fecha dd/mm/aaaa; nada de días que faltan", () => {
    const [pruebas, produccion] = armarLaListaDeAmbientes([vigente(), pendiente]);
    expect(pruebas?.vence).toBe("Vence 12/10/2028");
    expect(produccion?.vence).toBeNull();
  });
});

describe("desde qué paso arranca cada estado", () => {
  it("falta cargar: el paso 1, sin alias", () => {
    expect(armarElAmbiente({ ambiente: "PRODUCCION", situacion: "FALTA_CARGAR" })).toEqual({
      vista: "generar",
      aliasInicial: "",
    });
  });

  it("pedido generado: el paso 3 contra el pedido del estado, con alias y titular", () => {
    expect(armarElAmbiente(pendiente)).toEqual({
      vista: "cargar",
      certificadoId: "id-del-pedido",
      datos: [
        { rotulo: "Alias", valor: "pedernalprod" },
        { rotulo: "Titular", valor: "20-12345678-6" },
      ],
    });
  });

  it("vigente: el detalle con alias, titular y vencimiento, y el alias para «Reemplazar»; sin cartel", () => {
    expect(armarElAmbiente(vigente())).toMatchObject({
      vista: "detalle",
      aliasInicial: "pedernalprueba",
      datos: [
        { rotulo: "Alias", valor: "pedernalprueba" },
        { rotulo: "Titular", valor: "20-12345678-6" },
        { rotulo: "Vence", valor: "12/10/2028" },
      ],
      cartel: null,
    });
  });

  it("vencido: el cartel «Vencido»", () => {
    expect(armarElAmbiente(vigente({ vencido: true }))).toMatchObject({
      cartel: { texto: "Vencido" },
    });
  });
});

describe("el vencimiento sale como fecha civil de Argentina", () => {
  const delServidor = (venceEn: string) =>
    aCertificadoParaMostrar({
      ambiente: "PRODUCCION",
      situacion: "VIGENTE",
      alias: "a",
      cuitTitular: CUIT,
      venceEn,
      vencido: false,
    });

  it("un instante a las 02:00 UTC es todavía el día anterior en Argentina (UTC-3)", () => {
    expect(delServidor("2028-10-13T02:00:00.000Z")).toMatchObject({ vence: "2028-10-12" });
  });

  it("a las 03:00 UTC ya es el día siguiente; en fin de año también", () => {
    expect(delServidor("2028-10-13T03:00:00.000Z")).toMatchObject({ vence: "2028-10-13" });
    expect(delServidor("2029-01-01T01:59:59.000Z")).toMatchObject({ vence: "2028-12-31" });
  });

  it("lo que no es vigente pasa tal cual", () => {
    expect(aCertificadoParaMostrar(pendiente)).toEqual(pendiente);
  });
});

describe("la dirección del ambiente y los dos pedidos", () => {
  it("el segmento de la dirección es un ambiente o nada", () => {
    expect(ambienteDelSegmento("pruebas")).toBe("HOMOLOGACION");
    expect(ambienteDelSegmento("produccion")).toBe("PRODUCCION");
    expect(ambienteDelSegmento("HOMOLOGACION")).toBeNull();
    expect(ambienteDelSegmento("")).toBeNull();
    expect(rutaDelCertificadoDe("PRODUCCION")).toBe(
      "/configuracion-fiscal/certificado-de-arca/produccion",
    );
  });

  it("el pedido lleva el id de idempotencia y solo los campos que el servidor lee", () => {
    expect(
      armarElPedidoDeCertificado(
        { alias: "a", cuitTitular: "20-1", organizacion: "Mi Empresa" },
        "id-1",
        "emisor-1",
        "PRODUCCION",
      ),
    ).toEqual({
      id: "id-1",
      emisorId: "emisor-1",
      ambiente: "PRODUCCION",
      alias: "a",
      cuitTitular: "20-1",
      organizacion: "Mi Empresa",
    });
    expect(armarLaCargaDeCertificado("c-1", "texto")).toEqual({
      certificadoId: "c-1",
      certificadoPem: "texto",
    });
  });

  it("el campo marcado es el del servidor o ninguno", () => {
    expect(lugarDelErrorDelPedido("cuitTitular")).toBe("cuitTitular");
    expect(lugarDelErrorDelPedido("constructor")).toBeNull();
    expect(lugarDelErrorDelPedido(undefined)).toBeNull();
    expect(lugarDelErrorDeLaCarga("certificadoPem")).toBe("certificadoPem");
    expect(lugarDelErrorDeLaCarga("alias")).toBeNull();
  });

  it("el archivo del pedido se llama como el alias, sin nada raro", () => {
    expect(nombreDelArchivoDelPedido("pedernalprod")).toBe("pedernalprod.csr");
    expect(nombreDelArchivoDelPedido("../../x y")).toBe("xy.csr");
    expect(nombreDelArchivoDelPedido("")).toBe("pedido.csr");
  });
});

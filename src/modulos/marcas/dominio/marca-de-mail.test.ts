import { describe, expect, it } from "vitest";
import { normalizarHost, type Host } from "./host";
import { decidirMarcaDeMail, type DatosDeMarcaParaMail } from "./marca-de-mail";

const host = (texto: string): Host => {
  const r = normalizarHost(texto);
  if (!r.ok) throw new Error("host de prueba inválido");
  return r.valor;
};

const RESPALDO = { nombre: "Nombre de respaldo", urlBase: "https://respaldo.ejemplo.test" };

const datos = (parcial: Partial<DatosDeMarcaParaMail> = {}): DatosDeMarcaParaMail => ({
  esPrincipal: false,
  nombreVisible: "Mi Calendario",
  hostCanonico: host("app.micalendario.test"),
  ...parcial,
});

describe("decidirMarcaDeMail", () => {
  it("con versión vigente y host canónico, sale con la identidad de la marca (https, sin barra final)", () => {
    expect(decidirMarcaDeMail(datos(), RESPALDO)).toEqual({
      nombre: "Mi Calendario",
      urlBase: "https://app.micalendario.test",
    });
  });

  it("la principal con todo definido usa SU identidad, no el respaldo", () => {
    expect(
      decidirMarcaDeMail(
        datos({
          esPrincipal: true,
          nombreVisible: "Pedernal",
          hostCanonico: host("app.pedernal.test"),
        }),
        RESPALDO,
      ),
    ).toEqual({ nombre: "Pedernal", urlBase: "https://app.pedernal.test" });
  });

  it.each([
    ["sin versión vigente ni host", { nombreVisible: null, hostCanonico: null }],
    ["con versión pero sin host canónico", { hostCanonico: null }],
    ["con host canónico pero sin versión", { nombreVisible: null }],
  ])("la principal %s cae en el respaldo COMPLETO (nunca la mitad de cada uno)", (_c, parcial) => {
    expect(decidirMarcaDeMail(datos({ esPrincipal: true, ...parcial }), RESPALDO)).toEqual(
      RESPALDO,
    );
  });

  it.each([
    ["sin versión vigente ni host", { nombreVisible: null, hostCanonico: null }],
    ["con versión pero sin host canónico", { hostCanonico: null }],
    ["con host canónico pero sin versión", { nombreVisible: null }],
  ])("un producto %s NO tiene identidad: ni el respaldo ni la de otra marca", (_c, parcial) => {
    expect(decidirMarcaDeMail(datos(parcial), RESPALDO)).toBeNull();
  });

  it("devuelve un objeto nuevo con solo el nombre y el origen", () => {
    const r = decidirMarcaDeMail(datos({ esPrincipal: true, nombreVisible: null }), RESPALDO);
    expect(r).not.toBe(RESPALDO);
    expect(Object.keys(r ?? {}).sort()).toEqual(["nombre", "urlBase"]);
  });
});

import { describe, expect, it } from "vitest";
import type { DatosDeMarcaParaMail, LecturaDeMarcaParaMail } from "../../modulos/marcas/publico";
import { normalizarHost } from "../../modulos/marcas/publico";
import { tenantId } from "../../primitivas/identificadores/marca";
import { crearMarcasDeMail } from "./marcas-de-mail";

const RESPALDO = { nombre: "Respaldo", urlBase: "https://respaldo.test" };
const host = (texto: string) => {
  const r = normalizarHost(texto);
  if (!r.ok) throw new Error("host inválido");
  return r.valor;
};

function con(datos: DatosDeMarcaParaMail | null) {
  const pedidos: [string, Date][] = [];
  const lectura: LecturaDeMarcaParaMail = {
    delTenant(t, ahora) {
      pedidos.push([t, ahora]);
      return Promise.resolve(datos);
    },
  };
  return { marcas: crearMarcasDeMail(lectura, RESPALDO), pedidos };
}

describe("crearMarcasDeMail", () => {
  const ahora = new Date("2026-10-13T12:00:00Z");
  const t = tenantId("t1");

  it("lee la marca del tenant con el `ahora` dado y decide con el respaldo", async () => {
    const { marcas, pedidos } = con({
      esPrincipal: false,
      nombreVisible: "Mi Calendario",
      hostCanonico: host("app.mi.test"),
    });
    expect(await marcas.delTenant(t, ahora)).toEqual({
      nombre: "Mi Calendario",
      urlBase: "https://app.mi.test",
    });
    expect(pedidos).toEqual([["t1", ahora]]);
  });

  it("la principal sin identidad propia cae en el respaldo", async () => {
    const { marcas } = con({ esPrincipal: true, nombreVisible: null, hostCanonico: null });
    expect(await marcas.delTenant(t, ahora)).toEqual(RESPALDO);
  });

  it("un producto sin identidad propia: null", async () => {
    const { marcas } = con({ esPrincipal: false, nombreVisible: null, hostCanonico: null });
    expect(await marcas.delTenant(t, ahora)).toBeNull();
  });

  it("un tenant que la lectura no ve: null, ni siquiera el respaldo", async () => {
    const { marcas } = con(null);
    expect(await marcas.delTenant(t, ahora)).toBeNull();
  });
});

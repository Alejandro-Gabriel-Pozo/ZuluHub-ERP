import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { crearBaseAparte } from "./entorno";
import {
  Navegador,
  armarAutenticacionDePrueba,
  levantarProveedorLocal,
  perfilAlAzar,
  type AutenticacionDePrueba,
  type ProveedorLocal,
} from "./autenticacion-ingreso-apoyo";

const base = inject("baseDePruebas");
describe.skipIf(base === null)("humo", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let proveedor: ProveedorLocal;
  let a: AutenticacionDePrueba;
  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    proveedor = await levantarProveedorLocal();
    a = armarAutenticacionDePrueba(propia.base, proveedor);
  });
  afterAll(async () => {
    await a.cerrar();
    await proveedor.cerrar();
    await propia.destruir();
  });
  it("ingreso feliz", async () => {
    const n = new Navegador();
    const host = "app.marca-a.test";
    const r = await n.ingresarConGoogle(a.autenticacion, host, proveedor, perfilAlAzar());
    console.log(r.estado, r.ubicacion, r.texto, n.cookiesDe(host), a.registros);
    const s = await a.autenticacion.sesionDe(n.pedidoDe(host), host);
    console.log(s);
    expect(s).not.toBeNull();
  });
});

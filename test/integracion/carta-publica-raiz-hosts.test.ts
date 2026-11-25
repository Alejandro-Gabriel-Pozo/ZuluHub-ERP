import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarFuenteDePuertas } from "../../src/capacidades/experiencia/fuente-de-puertas";
import { crearResolutorDePuerta } from "../../src/capacidades/experiencia/resolutor";
import { crearConfiguracionPublicaDeHost } from "../../src/adaptadores/postgres/configuracion-publica-de-marca";
import { crearResolucionDeHost } from "../../src/adaptadores/postgres/resolucion-de-host";
import { crearTransaccionesPublicas } from "../../src/adaptadores/postgres/transacciones-publicas";
import {
  armarTxPublica,
  type TxPublicaCompleta,
} from "../../src/adaptadores/postgres/vidriera-publica";
import { normalizarHost } from "../../src/modulos/marcas/publico";
import type { CartaDeLaLista } from "../../src/puertos/vidriera-publica";
import { montarCatalogo } from "./catalogo-apoyo";
import {
  adaptadorReal,
  montarEnsayo,
  type Catalogo,
  type Ensayo,
} from "./carta-publica-lectura-apoyo";
import type { BaseDePruebas } from "./global";
import {
  crearDominio,
  crearDominioDeEmpresa,
  crearVersionDeMarcaConfirmada,
  hostAlAzar,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * Aislamiento de la raíz de la carta entre hosts, con la cadena REAL de la web (host → resolutor de la puerta → lista con el rol público): el host de la empresa A lista solo las de A, el de B
 * solo las de B, el compartido de la marca nada, y un host retirado, inactivo (pendiente o verificado, no activo) o desconocido (de otra instalación) no es una puerta: la web da la página neutra.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(base === null)("raíz de la carta: aislamiento entre hosts", () => {
  let c: Catalogo;
  let a: Ensayo;
  let b: Ensayo;
  let vidriera: ReturnType<typeof adaptadorReal>["vidriera"];
  let publicas: ReturnType<typeof adaptadorReal>["publicas"];
  let resolverPuerta: (host: string) => ReturnType<ReturnType<typeof crearResolutorDePuerta>>;
  let cerrarPuerta: () => Promise<void>;
  const hosts = { a: "", b: "", compartido: "", retirado: "", pendiente: "", verificado: "" };

  beforeAll(async () => {
    c = await montarCatalogo(base as BaseDePruebas);
    a = await montarEnsayo(c);
    b = await montarEnsayo(c);
    ({ vidriera, publicas } = adaptadorReal(c));
    const marca = await marcaPrincipal(c.dueno);
    await crearVersionDeMarcaConfirmada(c.dueno, marca, { nombreVisible: "Principal" });
    hosts.compartido = (await crearDominio(c.dueno, marca, { superficie: "CARTA" })).host;
    hosts.a = (await crearDominioDeEmpresa(c.dueno, a.e.empresa, { host: hostAlAzar() })).host;
    hosts.b = (await crearDominioDeEmpresa(c.dueno, b.e.empresa, { host: hostAlAzar() })).host;
    // Hosts de una empresa que no sirven: uno retirado, uno pendiente de verificación y uno verificado pero no activo (la empresa C no tiene otro vigente de CARTA).
    const otra = await montarEnsayo(c);
    hosts.retirado = (
      await crearDominioDeEmpresa(c.dueno, otra.e.empresa, { estado: "RETIRADO" })
    ).host;
    const pendiente = await montarEnsayo(c);
    hosts.pendiente = (
      await crearDominioDeEmpresa(c.dueno, pendiente.e.empresa, {
        estado: "PENDIENTE_VERIFICACION",
      })
    ).host;
    const verificada = await montarEnsayo(c);
    hosts.verificado = (
      await crearDominioDeEmpresa(c.dueno, verificada.e.empresa, { estado: "VERIFICADO" })
    ).host;
    const transacciones = crearTransaccionesPublicas<TxPublicaCompleta>({
      url: c.propia.base.publico,
      armar: (db) => armarTxPublica(db),
    });
    cerrarPuerta = () => transacciones.cerrar();
    const fuente = armarFuenteDePuertas({
      resolucion: () => crearResolucionDeHost(transacciones),
      configuracion: () => crearConfiguracionPublicaDeHost(transacciones),
    });
    resolverPuerta = crearResolutorDePuerta({
      consultarHost: fuente.consultarHost,
      leerMarca: fuente.leerMarca,
      normalizarHost: (crudo) => {
        const n = normalizarHost(crudo);
        return n.ok ? n.valor : null;
      },
      ahora: () => Date.now(),
      alFallar: () => undefined,
    });
  });
  afterAll(async () => {
    await cerrarPuerta();
    await publicas.cerrar();
    await c.cerrar();
  });

  /** Lo que hace la página `/`: resuelve la puerta del host y lista con lo que la puerta entrega; sin puerta de CARTA, la neutra (`null`). */
  async function raiz(host: string): Promise<readonly CartaDeLaLista[] | null> {
    const estado = await resolverPuerta(host);
    if (estado.tipo !== "RESUELTA") return null;
    return vidriera.listarDelHost(estado.puerta);
  }
  const codigos = (lista: readonly CartaDeLaLista[] | null) =>
    (lista ?? []).map((x) => x.codigo).sort();

  it("el host de A lista solo las de A, y el de B solo las de B", async () => {
    expect(codigos(await raiz(hosts.a))).toEqual([a.carta1.codigo, a.carta2.codigo].sort());
    expect(codigos(await raiz(hosts.b))).toEqual([b.carta1.codigo, b.carta2.codigo].sort());
  });

  it("el host compartido de la marca resuelve pero no lista nada", async () => {
    expect(await raiz(hosts.compartido)).toEqual([]);
  });

  it("un host retirado, pendiente, verificado sin activar o desconocido (de otra instalación) NO es una puerta: neutra", async () => {
    for (const host of [
      hosts.retirado,
      hosts.pendiente,
      hosts.verificado,
      "carta.de-otra-instalacion.test",
    ]) {
      expect(await raiz(host), host).toBeNull();
    }
  });
});

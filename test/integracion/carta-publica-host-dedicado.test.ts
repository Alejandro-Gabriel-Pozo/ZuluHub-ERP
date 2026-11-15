import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { armarFuenteDePuertas } from "../../src/capacidades/experiencia/fuente-de-puertas";
import { crearResolutorDePuerta } from "../../src/capacidades/experiencia/resolutor";
import type { PuertaResuelta } from "../../src/capacidades/experiencia/puerta";
import { crearConfiguracionPublicaDeHost } from "../../src/adaptadores/postgres/configuracion-publica-de-marca";
import { crearResolucionDeHost } from "../../src/adaptadores/postgres/resolucion-de-host";
import { crearTransaccionesPublicas } from "../../src/adaptadores/postgres/transacciones-publicas";
import {
  armarTxPublica,
  type TxPublicaCompleta,
} from "../../src/adaptadores/postgres/vidriera-publica";
import { normalizarHost } from "../../src/modulos/marcas/publico";
import type { VidrieraPublicada } from "../../src/puertos/vidriera-publica";
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
 * H-DOM-1 (aislamiento entre clientes): un host de carta DEDICADO a una empresa no puede servir la carta de OTRA empresa de la misma marca. Cadena REAL de punta a punta
 * (host → resolutor de la puerta con su caché → lectura pública de la carta con el rol `pedernal_publico`), igual que la arma la web.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(base === null)("host de carta dedicado a una empresa (H-DOM-1)", () => {
  let c: Catalogo;
  let a: Ensayo;
  let b: Ensayo;
  let vidriera: ReturnType<typeof adaptadorReal>["vidriera"];
  let publicas: ReturnType<typeof adaptadorReal>["publicas"];
  let resolverPuerta: (host: string) => ReturnType<ReturnType<typeof crearResolutorDePuerta>>;
  let cerrarPuerta: () => Promise<void>;
  let hostDeA: string;
  let hostDeB: string;
  let hostCompartido: string;

  beforeAll(async () => {
    c = await montarCatalogo(base as BaseDePruebas);
    a = await montarEnsayo(c);
    b = await montarEnsayo(c);
    ({ vidriera, publicas } = adaptadorReal(c));
    const marca = await marcaPrincipal(c.dueno);
    await crearVersionDeMarcaConfirmada(c.dueno, marca, { nombreVisible: "Principal" });
    hostCompartido = (await crearDominio(c.dueno, marca, { superficie: "CARTA" })).host;
    hostDeA = (await crearDominioDeEmpresa(c.dueno, a.e.empresa, { host: hostAlAzar() })).host;
    hostDeB = (await crearDominioDeEmpresa(c.dueno, b.e.empresa, { host: hostAlAzar() })).host;
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

  /** Lo que hace la web: resuelve la puerta del host y pide la carta con lo que la puerta entrega. */
  async function servir(host: string, codigo: string): Promise<VidrieraPublicada | null> {
    const estado = await resolverPuerta(host);
    if (estado.tipo !== "RESUELTA") return null;
    const puerta: PuertaResuelta = estado.puerta;
    return vidriera.porCodigo(puerta, codigo);
  }

  it("el host de la empresa A sirve la carta de A", async () => {
    expect((await servir(hostDeA, a.carta1.codigo))?.codigo).toBe(a.carta1.codigo);
  });

  it("el host de la empresa A NO sirve la carta de B (la 404 neutra: null)", async () => {
    expect(await servir(hostDeA, b.carta1.codigo)).toBeNull();
    expect(await servir(hostDeA, b.carta2.codigo)).toBeNull();
  });

  it("el host de B sirve solo B", async () => {
    expect((await servir(hostDeB, b.carta1.codigo))?.codigo).toBe(b.carta1.codigo);
    expect(await servir(hostDeB, a.carta1.codigo)).toBeNull();
  });

  it("el host compartido (de la marca) sirve las dos", async () => {
    expect((await servir(hostCompartido, a.carta1.codigo))?.codigo).toBe(a.carta1.codigo);
    expect((await servir(hostCompartido, b.carta1.codigo))?.codigo).toBe(b.carta1.codigo);
  });
});

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { armarConexiones } from "../../src/composicion/conexiones";
import {
  listarComprobantes,
  listarPuntosDeVentaDeLaSucursal,
  type DependenciasDeFacturacionWeb,
} from "../../src/composicion/facturacion-web";
import {
  discriminaIvaAlEmitir,
  listarPuntosDeVentaParaEmitir,
} from "../../src/composicion/lecturas-para-emitir-web";
import {
  resolverEmpresa,
  sucursalesDeLaEmpresa,
  type DependenciasDeSesion,
} from "../../src/composicion/sesion-y-empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { armarWeb } from "../../src/composicion/web";
import { sucursalId } from "../../src/primitivas/identificadores/marca";
import { contarSentencias, type ContadorDeSentencias } from "./contar-sentencias";
import { crearMembresiaDeBase } from "./fixtures-identidad";
import { asignarPlan, crearMundoDeMarca, crearPlanPublicado } from "./marcas-apoyo";
import { HOST_A, armarMundoWeb, ingresarEn, personaVinculada, type MundoWeb } from "./web-apoyo";

/**
 * CUÁNTAS sentencias hace la base por un pedido. Hoy el listado de comprobantes cuesta 15 (2 de la persona y sus empresas, 8 del listado
 * y 5 de abrir y cerrar las dos transacciones); antes de "una vez por pedido" eran 47 (informe de medición, sección 3: 6 transacciones y
 * la misma pregunta de permisos hasta 7 veces). El tope falla si alguien vuelve a abrir una transacción por consulta o a leer los permisos
 * de nuevo en cada una. No cuenta la lectura de la sesión de la librería de ingreso (otro rol, medida aparte en el informe del PR).
 *
 * Reproduce el orden de `cargarElListado` y de la barra (`apps/web`): la persona y la empresa (puerta `SESION`), y en el mismo pedido las
 * sucursales que puede elegir, los puntos de venta, la página y los permisos de la barra.
 */

const base = inject("baseDePruebas");

/** Medidos: listado 15, cuenta 12, emitir 15 (margen de 1; subirlos exige decir por qué en el PR). */
const TOPE_CUENTA = 13;
const TOPE_EMITIR = 16;

describe.skipIf(base === null)("sentencias por pedido: listado, cuenta y emitir", () => {
  let mundo: MundoWeb;
  let conexiones: ReturnType<typeof armarConexiones>;
  let web: ReturnType<typeof armarWeb>;
  let dependencias: DependenciasDeSesion;
  let dependenciasSinCompartir: DependenciasDeSesion;
  let dependenciasFiscales: DependenciasDeFacturacionWeb;
  let sesion: Awaited<ReturnType<typeof ingresarEn>>["sesion"];
  let contador: ContadorDeSentencias | null = null;

  beforeAll(async () => {
    if (base === null) return;
    mundo = await armarMundoWeb(base);
    const propia = mundo.propia.base;
    const yo = await ingresarEn(mundo, HOST_A);
    sesion = yo.sesion;
    const persona = await personaVinculada(mundo, yo.sesion);
    const m = await crearMundoDeMarca(mundo.dueno, { marca: mundo.marcaA });
    await crearMembresiaDeBase(mundo.dueno, m.empresa, persona, "GERENTE");
    const { version } = await crearPlanPublicado(mundo.dueno, { modulos: ["facturacion"] });
    await asignarPlan(mundo.dueno, m.tenant, version);
    await mundo.dueno.query(
      "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'facturacion')",
      [m.empresa],
    );
    conexiones = armarConexiones({
      fuente: () => ({
        PEDERNAL_CLAVE_CONTEXTO: `${propia.clave.kid}:${propia.clave.secreto.toString("hex")}`,
        PEDERNAL_DB_APP: propia.app,
      }),
    });
    web = armarWeb(conexiones);
    dependenciasSinCompartir = {
      autenticacion: () => mundo.auth.autenticacion,
      consultasDeSesion: web.consultasDeSesion,
      casosDeUsoDeIdentidad: web.casosDeUsoDeIdentidad,
      consultasDeEmpresas: web.consultasDeEmpresas,
      ahora: () => new Date(),
      respuesta: { registrar: () => undefined },
    };
    dependencias = { ...dependenciasSinCompartir, lecturasCompartidas: web.lecturasCompartidas };
    dependenciasFiscales = {
      casosDeUso: web.casosDeUsoDeFacturacion,
      consultas: web.consultasDeFacturacion,
      respuesta: dependencias.respuesta,
    };
    contador = contarSentencias(mundo.dueno);
  });
  afterAll(async () => {
    contador?.detener();
    await conexiones.transaccionesDeApp().cerrar();
    await mundo.cerrar();
  });

  /** Un pedido de pantalla: la entrada (persona y empresa) y, con ese contexto, las lecturas de la pantalla y de la barra. */
  async function pedido(
    d: DependenciasDeSesion,
    leer: (contexto: ContextoOperativo) => Promise<unknown>,
  ) {
    const entrada = await resolverEmpresa(d, {
      sesion,
      marcaId: mundo.marcaA,
      cookieDeEmpresa: null,
    });
    if (!entrada.ok || entrada.dato.tipo !== "ENTRA") throw new Error("el pedido no entró");
    const { contexto } = entrada.dato;
    const compartir = d.lecturasCompartidas?.();
    return compartir === undefined
      ? leer(contexto)
      : compartir.conLecturasCompartidas(contexto, () => leer(contexto));
  }

  const elegidaDe = async (contexto: ContextoOperativo) => {
    const elegibles = await web.consultasDeEmpresas().sucursalesElegibles(contexto);
    const id = elegibles.ok ? (elegibles.valor.find((s) => s.activa)?.id ?? null) : null;
    return { elegibles, elegida: id === null ? null : sucursalId(id) };
  };

  /** El orden de `cargarElListado` y de la barra. */
  const deLaPantallaDelListado = async (contexto: ContextoOperativo) => {
    const { elegibles, elegida } = await elegidaDe(contexto);
    const puntos = await listarPuntosDeVentaDeLaSucursal(dependenciasFiscales, contexto, elegida);
    const pagina = await listarComprobantes(dependenciasFiscales, contexto, elegida, undefined);
    const permisos = await web.consultasDeEmpresas().permisosDelActor(contexto);
    return { elegibles, puntos, pagina, permisos };
  };
  /** Cuenta: las sucursales para el selector y los permisos de la barra y de los accesos. */
  const deLaPantallaDeCuenta = async (contexto: ContextoOperativo) => {
    const sucursales = await sucursalesDeLaEmpresa(dependencias, contexto);
    const permisos = await web.consultasDeEmpresas().permisosDelActor(contexto);
    return { sucursales, permisos };
  };
  /** Emitir: si discrimina IVA, los puntos de venta para emitir y los permisos de la barra y del botón. */
  const deLaPantallaDeEmitir = async (contexto: ContextoOperativo) => {
    const discrimina = await discriminaIvaAlEmitir(dependenciasFiscales, contexto);
    const { elegibles, elegida } = await elegidaDe(contexto);
    const puntos = await listarPuntosDeVentaParaEmitir(dependenciasFiscales, contexto, elegida);
    const permisos = await web.consultasDeEmpresas().permisosDelActor(contexto);
    return { discrimina, elegibles, puntos, permisos };
  };

  /**
   * Medido (sin la lectura de la sesión de la librería de ingreso, que son 4 más): listado 15, cuenta y emitir `TOPES.*`. El margen es de 1; subir
   * un tope exige decir por qué en el PR. Inyección: sin compartir, cada pantalla supera su tope (la prueba lo exige), así que perder la
   * unidad o la memoria de permisos la hace fallar.
   */
  const TOPES = { listado: 16, cuenta: TOPE_CUENTA, emitir: TOPE_EMITIR } as const;
  const PANTALLAS = [
    ["listado", deLaPantallaDelListado],
    ["cuenta", deLaPantallaDeCuenta],
    ["emitir", deLaPantallaDeEmitir],
  ] as const;

  it.each(PANTALLAS)(
    "%s: no pasa del tope, devuelve lo mismo que sin compartir y sin compartir lo supera (inyección)",
    async (nombre, leer) => {
      contador?.reiniciar();
      const con = await pedido(dependencias, leer);
      const cuantas = contador?.sentencias().length ?? 0;
      contador?.reiniciar();
      const sin = await pedido(dependenciasSinCompartir, leer);
      const sinCompartir = contador?.sentencias().length ?? 0;
      expect(JSON.stringify(con)).toEqual(JSON.stringify(sin));
      expect(cuantas, `sentencias del pedido de ${nombre}: ${cuantas}`).toBeLessThanOrEqual(
        TOPES[nombre],
      );
      // Inyección: si se pierde la mejora, el pedido pasa del tope.
      expect(sinCompartir).toBeGreaterThan(TOPES[nombre]);
    },
  );

  it("el listado: una sola transacción de la empresa por pedido y el rol de la membresía se lee una vez (antes: 7)", async () => {
    contador?.reiniciar();
    await pedido(dependencias, deLaPantallaDelListado);
    const sentencias = contador?.sentencias() ?? [];
    expect(sentencias.filter((s) => /^(begin|start transaction)/i.test(s)).length).toBe(2);
    expect(sentencias.filter((s) => /from "membresia" as "m"/.test(s)).length).toBe(1);
  });
});

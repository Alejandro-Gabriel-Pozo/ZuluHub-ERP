import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import { ADMIN_DE_PRUEBA } from "./admins-de-prueba";
import { crearBaseAparte } from "./entorno";
import {
  codigoAlAzar,
  crearMarca as crearMarcaDeEscenario,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
} from "./marcas-apoyo";
import {
  auditoriaDePlataformaDe,
  clave,
  comoAdminAhora,
  crearCasosDeMarcasYPlanes,
  crearEntornoDeMarcasYPlanes,
  cuenta,
  desdeAhora,
  enLaHora,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * Los casos de uso de marcas de plataforma contra Postgres real (M5): crear una marca, guardar su borrador
 * y confirmar una versión. El ciclo completo, la auditoría exacta (quién, cuándo, qué cambió), la
 * idempotencia, y las reglas de negocio de punta a punta. La autorización y la atomicidad de todos los casos
 * están en `marcas-y-planes-autorizacion.test.ts`; la concurrencia, en `marcas-y-planes-concurrencia.test.ts`.
 * Base propia.
 */

const base = inject("baseDePruebas");

/** Colores que se leen: blanco sobre azul oscuro (≈ 6,7:1) y un acento oscuro sobre blanco. */
const TEMA = {
  primary: "#1d4ed8",
  "on-primary": "#ffffff",
  secondary: "#475569",
  accent: "#0f766e",
};
const LOGO = "/marcas/mc/logo.png";

describe.skipIf(base === null)("marcas de plataforma: casos de uso contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let casos: CasosDeUsoDeMarcasYPlanes;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    casos = crearCasosDeMarcasYPlanes(entorno);
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const crear = (extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["crearMarca"]>[1]> = {}) =>
    casos.crearMarca(comoAdminAhora(), {
      claveDeIdempotencia: clave(),
      codigo: codigoAlAzar(),
      marcaPadreId: principal,
      ...extra,
    });

  const filaDeMarca = async (id: string) =>
    (await dueno.query("select * from marca where id = $1", [id])).rows[0] as Record<
      string,
      unknown
    >;
  const filaDeVersion = async (id: string) =>
    (await dueno.query("select * from version_de_marca where id = $1", [id])).rows[0] as Record<
      string,
      unknown
    >;

  describe("crearMarca", () => {
    it("crea la marca hija de la principal: ACTIVA, nivel 1, con su constancia y su clave", async () => {
      const codigo = codigoAlAzar();
      const antes = await huellaDeEscrituras(dueno);
      const r = exito(await crear({ codigo }));
      expect(r.yaExistia).toBe(false);
      expect(await filaDeMarca(r.marcaId)).toMatchObject({
        codigo,
        marca_padre_id: principal,
        nivel: 1,
        estado: "ACTIVA",
        es_principal: false,
        version: 1,
      });
      const despues = await huellaDeEscrituras(dueno);
      expect(despues).toEqual({
        ...antes,
        marcas: antes.marcas + 1,
        auditoriaDePlataforma: antes.auditoriaDePlataforma + 1,
        claves: antes.claves + 1,
      });
      const constancias = await auditoriaDePlataformaDe(dueno, "marca", r.marcaId);
      expect(constancias).toHaveLength(1);
      expect(constancias[0]).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "MARCA_CREADA",
        antes: null,
        despues: { codigo, marcaPadreId: principal, nivel: 1, estado: "ACTIVA" },
      });
    });

    it("una marca sin padre es de nivel 0", async () => {
      const r = exito(await crear({ marcaPadreId: null }));
      expect(await filaDeMarca(r.marcaId)).toMatchObject({ marca_padre_id: null, nivel: 0 });
    });

    it("repetir con la misma clave devuelve la misma marca con yaExistia, sin escribir ni auditar de nuevo", async () => {
      const entrada = {
        claveDeIdempotencia: clave(),
        codigo: codigoAlAzar(),
        marcaPadreId: principal,
      };
      const primera = exito(await casos.crearMarca(comoAdminAhora(), entrada));
      const antes = await huellaDeEscrituras(dueno);
      const otra = exito(await casos.crearMarca(comoAdminAhora(), entrada));
      expect(otra).toEqual({ marcaId: primera.marcaId, yaExistia: true });
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("crear la marca que ya existe con OTRA clave es éxito sin escribir ni auditar (yaExistia)", async () => {
      const codigo = codigoAlAzar();
      const primera = exito(await crear({ codigo }));
      const antes = await huellaDeEscrituras(dueno);
      const otra = exito(await crear({ codigo }));
      expect(otra).toEqual({ marcaId: primera.marcaId, yaExistia: true });
      expect(await auditoriaDePlataformaDe(dueno, "marca", primera.marcaId)).toHaveLength(1);
      // La clave nueva sí se registra (la repetición futura devuelve lo mismo).
      expect(await huellaDeEscrituras(dueno)).toEqual({ ...antes, claves: antes.claves + 1 });
    });

    it("la misma clave con otra entrada es CLAVE_REUTILIZADA y no escribe", async () => {
      const claveDeIdempotencia = clave();
      exito(await crear({ claveDeIdempotencia, codigo: codigoAlAzar() }));
      const antes = await huellaDeEscrituras(dueno);
      expect(falla(await crear({ claveDeIdempotencia, codigo: codigoAlAzar() }))).toBe(
        "CLAVE_REUTILIZADA",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("el mismo código con otro padre es CODIGO_DE_MARCA_OCUPADO", async () => {
      const codigo = codigoAlAzar();
      exito(await crear({ codigo, marcaPadreId: principal }));
      expect(falla(await crear({ codigo, marcaPadreId: null }))).toBe("CODIGO_DE_MARCA_OCUPADO");
    });

    it("rechaza lo mal formado y lo imposible, sin escribir nada", async () => {
      const retirada = await crearMarcaDeEscenario(dueno);
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [retirada]);
      const hija = await crearMarcaDeEscenario(dueno, { padre: principal });
      const antes = await huellaDeEscrituras(dueno);
      const casosMalos: Array<[string, Parameters<typeof crear>[0], unknown]> = [
        ["código inválido", { codigo: "Mi Marca" }, "CODIGO_DE_MARCA_INVALIDO"],
        ["código de una letra", { codigo: "a" }, "CODIGO_DE_MARCA_INVALIDO"],
        ["padre que no es un id", { marcaPadreId: "no-es-un-uuid" }, "ID_INVALIDO"],
        [
          "padre inexistente",
          { marcaPadreId: "00000000-0000-4000-8000-00000000dead" },
          "MARCA_PADRE_NO_ENCONTRADA",
        ],
        ["padre retirado", { marcaPadreId: retirada }, "MARCA_PADRE_RETIRADA"],
        [
          "padre que no es la principal (nivel 2)",
          { marcaPadreId: hija },
          "NIVEL_DE_MARCA_NO_HABILITADO",
        ],
        [
          "clave de idempotencia corta",
          { claveDeIdempotencia: "corta" },
          "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
        ],
      ];
      for (const [nombre, extra, esperado] of casosMalos) {
        expect(falla(await crear(extra)), nombre).toBe(esperado);
      }
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });
  });

  describe("guardarBorradorDeMarca", () => {
    const guardar = (
      marcaId: string,
      versionEsperada: number | null,
      extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["guardarBorradorDeMarca"]>[1]> = {},
    ) =>
      casos.guardarBorradorDeMarca(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        marcaId,
        versionEsperada,
        ...extra,
      });
    const unaMarca = async () => exito(await crear()).marcaId;

    it("abre el borrador (versionEsperada null) con lo que se manda, en forma canónica, y deja su constancia", async () => {
      const marca = await unaMarca();
      const r = exito(
        await guardar(marca, null, {
          nombreVisible: "  Mi Calendario ",
          tema: TEMA,
          logo: LOGO,
          vocabulario: { "rol.gerente.nombre": " Encargado " },
          modulosIniciales: ["ventas", "caja", "ventas"],
        }),
      );
      expect(r.version).toBe(1);
      expect(await filaDeVersion(r.borradorId)).toMatchObject({
        marca_id: marca,
        estado: "BORRADOR",
        numero: null,
        nombre_visible: "Mi Calendario",
        tema: TEMA,
        logo: LOGO,
        vocabulario: { "rol.gerente.nombre": "Encargado" },
        modulos_iniciales: ["ventas", "caja"],
        plan_por_defecto_id: null,
      });
      const [constancia] = await auditoriaDePlataformaDe(dueno, "version_de_marca", r.borradorId);
      expect(constancia).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        accion: "MARCA_BORRADOR_GUARDADO",
        antes: null,
        despues: {
          marcaId: marca,
          esNuevo: true,
          version: 1,
          nombreVisible: "Mi Calendario",
          tema: TEMA,
          logo: LOGO,
          modulosIniciales: ["ventas", "caja"],
          planPorDefectoId: null,
          // El vocabulario va como pares, nunca como un objeto cuyas claves son los textos.
          vocabulario: [{ texto: "rol.gerente.nombre", antes: null, despues: "Encargado" }],
        },
      });
    });

    it("guarda el aspecto (cinco datos de lista cerrada), lo reemplaza entero, lo audita y mandarlo igual no escribe", async () => {
      const marca = await unaMarca();
      const primero = exito(
        await guardar(marca, null, {
          nombreVisible: "Con aspecto",
          aspecto: { esquinas: "SUAVE", estilo: "MODERNO" },
        }),
      );
      expect(await filaDeVersion(primero.borradorId)).toMatchObject({
        aspecto: { estilo: "MODERNO", esquinas: "SUAVE" },
      });
      const [alta] = await auditoriaDePlataformaDe(dueno, "version_de_marca", primero.borradorId);
      expect(alta).toMatchObject({
        antes: null,
        despues: { aspecto: { estilo: "MODERNO", esquinas: "SUAVE" } },
      });

      // Mandar el mismo aspecto (en otro orden) no cambia nada: éxito sin escribir ni auditar.
      const igual = exito(
        await guardar(marca, 1, { aspecto: { estilo: "MODERNO", esquinas: "SUAVE" } }),
      );
      expect(igual).toEqual({ borradorId: primero.borradorId, version: 1 });
      expect(
        await auditoriaDePlataformaDe(dueno, "version_de_marca", primero.borradorId),
      ).toHaveLength(1);

      // Un aspecto nuevo REEMPLAZA al anterior entero (no se mezclan).
      const segundo = exito(await guardar(marca, 1, { aspecto: { titulos: "SERIF" } }));
      expect(segundo.version).toBe(2);
      expect(await filaDeVersion(segundo.borradorId)).toMatchObject({
        aspecto: { titulos: "SERIF" },
      });
      const constancias = await auditoriaDePlataformaDe(
        dueno,
        "version_de_marca",
        segundo.borradorId,
      );
      expect(constancias[1]).toMatchObject({
        antes: { aspecto: { estilo: "MODERNO", esquinas: "SUAVE" } },
        despues: { aspecto: { titulos: "SERIF" } },
      });
      // `{}` lo vacía: vuelve a heredar.
      exito(await guardar(marca, 2, { aspecto: {} }));
      expect(await filaDeVersion(segundo.borradorId)).toMatchObject({ aspecto: {} });
    });

    it("edita el borrador: reemplaza ENTERO lo que se manda, conserva lo que no, y audita antes y después", async () => {
      const marca = await unaMarca();
      const primero = exito(
        await guardar(marca, null, {
          nombreVisible: "Uno",
          tema: TEMA,
          vocabulario: { "rol.gerente.nombre": "Encargado", "rol.operador.nombre": "Mozo" },
        }),
      );
      const segundo = exito(
        await guardar(marca, 1, {
          tema: { primary: "#000000" },
          vocabulario: { "rol.gerente.nombre": "Jefe" },
          logo: LOGO,
        }),
      );
      expect(segundo).toEqual({ borradorId: primero.borradorId, version: 2 });
      expect(await filaDeVersion(segundo.borradorId)).toMatchObject({
        nombre_visible: "Uno",
        tema: { primary: "#000000" },
        logo: LOGO,
        vocabulario: { "rol.gerente.nombre": "Jefe" },
        version: 2,
      });
      const constancias = await auditoriaDePlataformaDe(
        dueno,
        "version_de_marca",
        segundo.borradorId,
      );
      expect(constancias).toHaveLength(2);
      expect(constancias[1]).toMatchObject({
        accion: "MARCA_BORRADOR_GUARDADO",
        antes: { nombreVisible: "Uno", tema: TEMA, logo: null },
        despues: {
          esNuevo: false,
          version: 2,
          tema: { primary: "#000000" },
          logo: LOGO,
          vocabulario: [
            { texto: "rol.gerente.nombre", antes: "Encargado", despues: "Jefe" },
            { texto: "rol.operador.nombre", antes: "Mozo", despues: null },
          ],
        },
      });
    });

    it("null vacía el campo (vuelve a heredar) y se distingue de no mandarlo", async () => {
      const marca = await unaMarca();
      exito(
        await guardar(marca, null, {
          nombreVisible: "Uno",
          logo: LOGO,
          modulosIniciales: ["caja"],
        }),
      );
      const r = exito(await guardar(marca, 1, { logo: null, modulosIniciales: null }));
      expect(await filaDeVersion(r.borradorId)).toMatchObject({
        nombre_visible: "Uno",
        logo: null,
        modulos_iniciales: null,
      });
    });

    it("guardar sin cambios reales es éxito sin escribir, sin subir la versión y sin auditar", async () => {
      const marca = await unaMarca();
      const primero = exito(await guardar(marca, null, { nombreVisible: "Uno", tema: TEMA }));
      const antes = await huellaDeEscrituras(dueno);
      // Ni siquiera la clave nueva escribe constancia: la repetición futura la registra.
      const otra = exito(await guardar(marca, 1, { nombreVisible: "Uno", tema: { ...TEMA } }));
      expect(otra).toEqual(primero);
      expect(await huellaDeEscrituras(dueno)).toEqual({ ...antes, claves: antes.claves + 1 });
      expect((await filaDeVersion(primero.borradorId))["version"]).toBe(1);
    });

    it("repetir con la misma clave devuelve lo mismo, sin escribir ni auditar de nuevo", async () => {
      const marca = await unaMarca();
      const entrada = {
        claveDeIdempotencia: clave(),
        marcaId: marca,
        versionEsperada: null,
        nombreVisible: "Uno",
      };
      const primera = exito(await casos.guardarBorradorDeMarca(comoAdminAhora(), entrada));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await casos.guardarBorradorDeMarca(comoAdminAhora(), entrada))).toEqual(primera);
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      // Misma clave y otro contenido: CLAVE_REUTILIZADA.
      expect(
        falla(
          await casos.guardarBorradorDeMarca(comoAdminAhora(), {
            ...entrada,
            nombreVisible: "Dos",
          }),
        ),
      ).toBe("CLAVE_REUTILIZADA");
    });

    it("VERSION_DESACTUALIZADA: esperar «sin borrador» cuando ya hay uno, o una versión que ya cambió", async () => {
      const marca = await unaMarca();
      exito(await guardar(marca, null, { nombreVisible: "Uno" }));
      expect(falla(await guardar(marca, null, { nombreVisible: "Dos" }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      exito(await guardar(marca, 1, { nombreVisible: "Dos" }));
      expect(falla(await guardar(marca, 1, { nombreVisible: "Tres" }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      expect(falla(await guardar(marca, 7, { nombreVisible: "Tres" }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
      const otraMarca = await unaMarca();
      expect(falla(await guardar(otraMarca, 1, { nombreVisible: "x" }))).toBe(
        "VERSION_DESACTUALIZADA",
      );
    });

    it("rechaza cada campo mal formado con su motivo y sin escribir", async () => {
      const marca = await unaMarca();
      const antes = await huellaDeEscrituras(dueno);
      const malos: Array<[string, Partial<Parameters<typeof guardar>[2]>, unknown]> = [
        ["nombre vacío", { nombreVisible: "   " }, "NOMBRE_DE_MARCA_INVALIDO"],
        ["nombre con <", { nombreVisible: "a<b" }, "NOMBRE_DE_MARCA_INVALIDO"],
        [
          "tema con un token ajeno",
          { tema: { fondo: "#000000" } },
          { codigo: "TEMA_INVALIDO", token: "fondo" },
        ],
        [
          "tema con un color corto",
          { tema: { primary: "#fff" } },
          { codigo: "TEMA_INVALIDO", token: "primary" },
        ],
        [
          "aspecto con un token ajeno",
          { aspecto: { fuente: "SANS" } },
          { codigo: "ASPECTO_INVALIDO", token: "fuente" },
        ],
        [
          "aspecto con un valor fuera de la lista",
          { aspecto: { estilo: "BARROCO" } },
          { codigo: "ASPECTO_INVALIDO", token: "estilo" },
        ],
        ["logo svg", { logo: "/marcas/mc/logo.svg" }, "LOGO_INVALIDO"],
        [
          "texto de una clave que no existe",
          { vocabulario: { "no.existe.nada": "x" } },
          { codigo: "CLAVE_DE_TEXTO_DESCONOCIDA", texto: "no.existe.nada" },
        ],
        [
          "texto con <",
          { vocabulario: { "rol.gerente.nombre": "<b>" } },
          { codigo: "TEXTO_INVALIDO", texto: "rol.gerente.nombre", motivo: "CARACTER_PROHIBIDO" },
        ],
        [
          "texto con marcadores distintos",
          { vocabulario: { "error.limite_del_plan": "sin marcador" } },
          { codigo: "MARCADORES_DISTINTOS", texto: "error.limite_del_plan" },
        ],
        [
          "módulo en desarrollo",
          { modulosIniciales: ["comandas"] },
          { codigo: "MODULO_DESCONOCIDO", modulo: "comandas" },
        ],
        [
          "módulo obligatorio",
          { modulosIniciales: ["nucleo"] },
          { codigo: "MODULO_DESCONOCIDO", modulo: "nucleo" },
        ],
        ["plan que no es un id", { planPorDefectoId: "x" }, "ID_INVALIDO"],
        [
          "plan inexistente",
          { planPorDefectoId: "00000000-0000-4000-8000-00000000dead" },
          "PLAN_NO_ENCONTRADO",
        ],
      ];
      for (const [nombre, extra, esperado] of malos) {
        expect(falla(await guardar(marca, null, extra)), nombre).toEqual(esperado);
      }
      expect(falla(await guardar("no-es-un-uuid", null))).toBe("ID_INVALIDO");
      expect(falla(await guardar(marca, 0))).toBe("VERSION_ESPERADA_INVALIDA");
      expect(falla(await guardar(marca, 1.5))).toBe("VERSION_ESPERADA_INVALIDA");
      expect(falla(await guardar("00000000-0000-4000-8000-00000000dead", null))).toBe(
        "MARCA_NO_ENCONTRADA",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("una marca retirada no admite borradores", async () => {
      const marca = await unaMarca();
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [marca]);
      expect(falla(await guardar(marca, null, { nombreVisible: "Uno" }))).toBe("MARCA_RETIRADA");
    });

    it("acepta como plan por defecto un plan que existe (aunque no tenga versiones)", async () => {
      const marca = await unaMarca();
      const plan = (await crearPlanPublicado(dueno, { modulos: ["caja"] })).plan;
      const r = exito(await guardar(marca, null, { planPorDefectoId: plan.toUpperCase() }));
      expect(await filaDeVersion(r.borradorId)).toMatchObject({ plan_por_defecto_id: plan });
    });
  });

  describe("confirmarVersionDeMarca", () => {
    const confirmar = (
      marcaId: string,
      extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["confirmarVersionDeMarca"]>[1]> = {},
    ) =>
      casos.confirmarVersionDeMarca(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        marcaId,
        vigenteDesde: desdeAhora(0),
        motivo: "primera versión",
        reemplazaProgramada: false,
        ...extra,
      });
    const guardar = (
      marcaId: string,
      versionEsperada: number | null,
      extra: Partial<Parameters<CasosDeUsoDeMarcasYPlanes["guardarBorradorDeMarca"]>[1]>,
    ) =>
      casos.guardarBorradorDeMarca(comoAdminAhora(), {
        claveDeIdempotencia: clave(),
        marcaId,
        versionEsperada,
        ...extra,
      });
    /** Una marca con su borrador COMPLETO (nombre, colores, logo, módulos iniciales y plan por defecto). */
    async function marcaConBorrador(extra: Partial<Parameters<typeof guardar>[2]> = {}) {
      const marca = exito(await crear({ marcaPadreId: null })).marcaId;
      const { plan } = await crearPlanPublicado(dueno, { modulos: ["caja", "ventas"] });
      const borrador = exito(
        await guardar(marca, null, {
          nombreVisible: "Mi Calendario",
          tema: TEMA,
          logo: LOGO,
          modulosIniciales: ["caja"],
          planPorDefectoId: plan,
          ...extra,
        }),
      );
      return { marca, plan, borrador };
    }

    it("confirma el borrador: versión 1 congelada, quién la confirmó y por qué, y la constancia con antes nulo", async () => {
      const { marca, borrador } = await marcaConBorrador();
      const vigenteDesde = desdeAhora(0);
      const r = exito(await confirmar(marca, { vigenteDesde, motivo: "  alta de la marca " }));
      expect(r).toEqual({ numero: 1 });
      const fila = await filaDeVersion(borrador.borradorId);
      expect(fila).toMatchObject({
        estado: "CONFIRMADA",
        numero: 1,
        motivo: "alta de la marca",
        confirmada_por: ADMIN_DE_PRUEBA,
        reemplaza_programada: false,
      });
      expect((fila["vigente_desde"] as Date).getTime()).toBe(vigenteDesde.getTime());
      const constancias = await auditoriaDePlataformaDe(dueno, "marca", marca);
      const confirmacion = constancias.find((c) => c.accion === "MARCA_VERSION_CONFIRMADA");
      expect(confirmacion).toMatchObject({
        actor: ADMIN_DE_PRUEBA,
        antes: null,
        despues: {
          numero: 1,
          motivo: "alta de la marca",
          reemplazaProgramada: false,
          nombreVisible: "Mi Calendario",
          tema: TEMA,
          logo: LOGO,
          modulosIniciales: ["caja"],
        },
      });
      expect(confirmacion?.despues?.["vigenteDesde"]).toBe(vigenteDesde.toISOString());
    });

    it("la versión confirmada lleva el aspecto del borrador y la constancia lo registra", async () => {
      const aspecto = { estilo: "LUDICO", superficie: "CALIDA", ingreso: "CENTRADO" };
      const { marca, borrador } = await marcaConBorrador({ aspecto });
      exito(await confirmar(marca));
      expect(await filaDeVersion(borrador.borradorId)).toMatchObject({
        estado: "CONFIRMADA",
        aspecto,
      });
      const constancias = await auditoriaDePlataformaDe(dueno, "marca", marca);
      const confirmacion = constancias.find((c) => c.accion === "MARCA_VERSION_CONFIRMADA");
      expect(confirmacion?.despues).toMatchObject({ aspecto });
    });

    it("una segunda versión audita la diferencia contra la que regía, y la congelada no se puede tocar ni con el dueño", async () => {
      const { marca } = await marcaConBorrador();
      exito(await confirmar(marca, { vigenteDesde: desdeAhora(-30) }));
      exito(
        await guardar(marca, null, {
          nombreVisible: "Mi Calendario 2",
          vocabulario: { "rol.operador.nombre": "Mozo" },
        }),
      );
      // El borrador nuevo hereda la definición de la anterior? No: arranca vacío; hay que completar lo que falta.
      expect(falla(await confirmar(marca))).toEqual({
        codigo: "DEFINICION_INCOMPLETA",
        faltan: [
          "tema.primary",
          "tema.on-primary",
          "tema.secondary",
          "tema.accent",
          "logo",
          "modulos_iniciales",
          "plan_por_defecto",
        ],
      });
      const { plan } = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      exito(
        await guardar(marca, 1, {
          tema: TEMA,
          logo: LOGO,
          modulosIniciales: [],
          planPorDefectoId: plan,
        }),
      );
      expect(exito(await confirmar(marca, { motivo: "cambio de nombre" }))).toEqual({ numero: 2 });
      const constancias = (await auditoriaDePlataformaDe(dueno, "marca", marca)).filter(
        (c) => c.accion === "MARCA_VERSION_CONFIRMADA",
      );
      expect(constancias).toHaveLength(2);
      expect(constancias[1]).toMatchObject({
        antes: { numero: 1, nombreVisible: "Mi Calendario", modulosIniciales: ["caja"] },
        despues: {
          numero: 2,
          nombreVisible: "Mi Calendario 2",
          modulosIniciales: [],
          vocabulario: [{ texto: "rol.operador.nombre", antes: null, despues: "Mozo" }],
        },
      });
      await expect(
        dueno.query(
          "update version_de_marca set nombre_visible = 'otro' where marca_id = $1 and numero = 1",
          [marca],
        ),
      ).rejects.toMatchObject({ constraint: "version_de_marca_confirmada_inmutable" });
    });

    it("una vigencia programada queda programada y exige reemplazaProgramada para ser reemplazada", async () => {
      const { marca } = await marcaConBorrador();
      exito(await confirmar(marca, { vigenteDesde: desdeAhora(3600) }));
      const { plan } = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      exito(
        await guardar(marca, null, {
          nombreVisible: "Otra",
          tema: TEMA,
          logo: LOGO,
          modulosIniciales: [],
          planPorDefectoId: plan,
        }),
      );
      expect(falla(await confirmar(marca, { vigenteDesde: desdeAhora(7200) }))).toBe(
        "CAMBIO_PROGRAMADO_PENDIENTE",
      );
      expect(
        exito(
          await confirmar(marca, { vigenteDesde: desdeAhora(7200), reemplazaProgramada: true }),
        ),
      ).toEqual({ numero: 2 });
      const fila = (
        await dueno.query<{ reemplaza_programada: boolean }>(
          "select reemplaza_programada from version_de_marca where marca_id = $1 and numero = 2",
          [marca],
        )
      ).rows[0];
      expect(fila).toEqual({ reemplaza_programada: true });
    });

    it("hereda de la marca padre: una hija que solo define su nombre confirma con los colores, el logo, los módulos y el plan de la principal", async () => {
      const { plan } = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const padre = await crearMarcaDeEscenario(dueno);
      await crearVersionDeMarcaConfirmada(dueno, padre, {
        nombreVisible: "Padre",
        tema: TEMA,
        logo: LOGO,
        modulosIniciales: ["caja"],
        planPorDefecto: plan,
      });
      // La hija es hija de `padre`: se arma con el cliente del dueño (los casos de v1 solo admiten la principal).
      const hija = await crearMarcaDeEscenario(dueno, { padre });
      exito(await guardar(hija, null, { nombreVisible: "Hija" }));
      expect(exito(await confirmar(hija))).toEqual({ numero: 1 });
    });

    it("rechaza lo que no se puede confirmar, con su motivo, sin escribir nada", async () => {
      const { marca } = await marcaConBorrador();
      const antes = await huellaDeEscrituras(dueno);
      expect(falla(await confirmar(marca, { motivo: "   " }))).toBe("MOTIVO_OBLIGATORIO");
      expect(falla(await confirmar(marca, { motivo: "m".repeat(501) }))).toBe(
        "MOTIVO_DEMASIADO_LARGO",
      );
      expect(falla(await confirmar(marca, { vigenteDesde: desdeAhora(-3600) }))).toBe(
        "VIGENCIA_RETROACTIVA",
      );
      expect(falla(await confirmar(marca, { vigenteDesde: new Date("no es una fecha") }))).toBe(
        "VIGENCIA_INVALIDA",
      );
      expect(falla(await confirmar("no-es-un-uuid"))).toBe("ID_INVALIDO");
      expect(falla(await confirmar("00000000-0000-4000-8000-00000000dead"))).toBe(
        "MARCA_NO_ENCONTRADA",
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });

    it("sin borrador no hay nada que confirmar (SIN_BORRADOR), y un borrador incompleto lo dice", async () => {
      const marca = exito(await crear({ marcaPadreId: null })).marcaId;
      expect(falla(await confirmar(marca))).toBe("SIN_BORRADOR");
      exito(await guardar(marca, null, { nombreVisible: "Solo el nombre" }));
      expect(falla(await confirmar(marca))).toEqual({
        codigo: "DEFINICION_INCOMPLETA",
        faltan: [
          "tema.primary",
          "tema.on-primary",
          "tema.secondary",
          "tema.accent",
          "logo",
          "modulos_iniciales",
          "plan_por_defecto",
        ],
      });
    });

    it("exige que los colores se lean (contraste), que los módulos iniciales entren en el plan y que el plan no esté retirado", async () => {
      const ilegible = await marcaConBorrador({ tema: { ...TEMA, "on-primary": "#2563eb" } });
      const falloContraste = falla(await confirmar(ilegible.marca));
      expect(falloContraste).toMatchObject({ codigo: "CONTRASTE_INSUFICIENTE" });

      const fuera = await marcaConBorrador({ modulosIniciales: ["reservas"] });
      expect(falla(await confirmar(fuera.marca))).toEqual({
        codigo: "MODULO_INICIAL_FUERA_DEL_PLAN",
        modulo: "reservas",
      });

      const retirado = await marcaConBorrador();
      await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [retirado.plan]);
      expect(falla(await confirmar(retirado.marca))).toBe("PLAN_POR_DEFECTO_RETIRADO");
    });

    it("una marca retirada no confirma", async () => {
      const { marca } = await marcaConBorrador();
      await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [marca]);
      expect(falla(await confirmar(marca))).toBe("MARCA_RETIRADA");
    });

    it("repetir con la misma clave devuelve el mismo número sin confirmar otra versión ni auditar de nuevo; con otra clave ya no hay borrador", async () => {
      const { marca } = await marcaConBorrador();
      const entrada = {
        claveDeIdempotencia: clave(),
        marcaId: marca,
        vigenteDesde: desdeAhora(0),
        motivo: "primera",
        reemplazaProgramada: false,
      };
      const primera = exito(await casos.confirmarVersionDeMarca(comoAdminAhora(), entrada));
      const antes = await huellaDeEscrituras(dueno);
      expect(exito(await casos.confirmarVersionDeMarca(comoAdminAhora(), entrada))).toEqual(
        primera,
      );
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
      expect(falla(await confirmar(marca))).toBe("SIN_BORRADOR");
      expect(
        falla(
          await casos.confirmarVersionDeMarca(comoAdminAhora(), { ...entrada, motivo: "otra" }),
        ),
      ).toBe("CLAVE_REUTILIZADA");
      expect(
        await cuenta(
          dueno,
          "select count(*)::int as n from version_de_marca where marca_id = $1 and estado = 'CONFIRMADA'",
          [marca],
        ),
      ).toBe(1);
    });

    it("confirmar con la hora de un contexto en el pasado usa ESA hora para decidir la vigencia", async () => {
      // `ahora` es del contexto: la decisión no lee el reloj. Con un contexto adelantado, «hoy» es mañana.
      const { marca } = await marcaConBorrador();
      const manana = desdeAhora(86_400);
      const r = await casos.confirmarVersionDeMarca(enLaHora(manana), {
        claveDeIdempotencia: clave(),
        marcaId: marca,
        vigenteDesde: manana,
        motivo: "adelantada",
        reemplazaProgramada: false,
      });
      expect(exito(r)).toEqual({ numero: 1 });
    });
  });
});

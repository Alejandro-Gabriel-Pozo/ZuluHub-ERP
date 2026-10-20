import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import { ASPECTO_POR_DEFECTO, razonDeContraste } from "../../src/modulos/marcas/publico";
import type { CasosDeUsoDeMarcasYPlanes } from "../../src/plataforma/casos-de-uso/marcas-y-planes";
import type { ConsultasDeMarcasYPlanes } from "../../src/plataforma/consultas/consultas-de-marcas-y-planes";
import { crearBaseAparte } from "./entorno";
import {
  codigoAlAzar,
  crearBorradorDeMarca,
  crearMarca,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
} from "./marcas-apoyo";
import {
  clave,
  comoAdminAhora,
  crearCasosDeMarcasYPlanes,
  crearConsultasDeMarcasYPlanesDePrueba,
  crearEntornoDeMarcasYPlanes,
  enLaHora,
  exito,
  falla,
  huellaDeEscrituras,
  type TxDeMarcasYPlanesDePrueba,
} from "./marcas-y-planes-apoyo";

/**
 * `fichaDeMarca` con la definición EFECTIVA (herencia con origen por campo), el borrador efectivo, «¿se puede
 * confirmar?» y los contrastes, contra Postgres real y sobre una familia de tres marcas (principal, hija y nieta)
 * más una marca ajena que no hereda de nadie. El «¿se puede confirmar?» se compara siempre con lo que responde
 * el caso de uso REAL `confirmarVersionDeMarca` sobre los mismos datos. Base propia de este archivo.
 */

const base = inject("baseDePruebas");

const TEMA = {
  primary: "#1d4ed8",
  "on-primary": "#ffffff",
  secondary: "#475569",
  accent: "#0f766e",
};
const LOGO = "/marcas/principal/logo.png";

describe.skipIf(base === null)("fichaDeMarca efectiva: contra Postgres", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeMarcasYPlanesDePrueba>;
  let consultas: ConsultasDeMarcasYPlanes;
  let casos: CasosDeUsoDeMarcasYPlanes;

  // La familia: principal → hija → nieta. Y una marca ajena, sin padre.
  const f = {
    principal: "",
    hija: "",
    nieta: "",
    ajena: "",
    planDeLaPrincipal: "",
    versionDelPlan: "",
  };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeMarcasYPlanes(propia.base);
    consultas = crearConsultasDeMarcasYPlanesDePrueba(entorno);
    casos = crearCasosDeMarcasYPlanes(entorno);

    const plan = await crearPlanPublicado(dueno, {
      codigo: "plan-base",
      nombreComercial: "Plan Base",
      modulos: ["caja"],
    });
    f.planDeLaPrincipal = plan.plan;
    f.versionDelPlan = plan.version;

    f.principal = await marcaPrincipal(dueno);
    await crearVersionDeMarcaConfirmada(dueno, f.principal, {
      nombreVisible: "Principal",
      tema: TEMA,
      aspecto: { estilo: "CLASICO" },
      logo: LOGO,
      vocabulario: { "rol.gerente.nombre": "Jefe" },
      modulosIniciales: ["caja"],
      planPorDefecto: plan.plan,
      desdeSegundos: -30,
    });
    f.hija = await crearMarca(dueno, { codigo: "hija", padre: f.principal });
    await crearVersionDeMarcaConfirmada(dueno, f.hija, {
      nombreVisible: "Hija",
      tema: { primary: "#336699" },
      aspecto: { superficie: "CALIDA" },
      vocabulario: { "rol.operador.nombre": "Mozo" },
      desdeSegundos: -30,
    });
    f.nieta = await crearMarca(dueno, { codigo: "nieta", padre: f.hija });
    await crearVersionDeMarcaConfirmada(dueno, f.nieta, {
      nombreVisible: "Nieta",
      desdeSegundos: -30,
    });
    f.ajena = await crearMarca(dueno, { codigo: "ajena" });
    await crearVersionDeMarcaConfirmada(dueno, f.ajena, {
      nombreVisible: "Ajena",
      tema: { primary: "#aa0000" },
      desdeSegundos: -30,
    });
  });

  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const ficha = async (marcaId: string) =>
    exito(await consultas.fichaDeMarca(comoAdminAhora(), { marcaId }));

  describe("la definición efectiva con el origen de cada campo", () => {
    it("la principal: lo que define es propio y lo que ninguna define, defecto", async () => {
      const { efectiva } = await ficha(f.principal);
      expect(efectiva).not.toBeNull();
      expect(efectiva?.nombreVisible).toEqual({ valor: "Principal", origen: { tipo: "propio" } });
      expect(efectiva?.tema.primary).toEqual({ valor: TEMA.primary, origen: { tipo: "propio" } });
      expect(efectiva?.logo).toEqual({ valor: LOGO, origen: { tipo: "propio" } });
      expect(efectiva?.aspecto.estilo).toEqual({ valor: "CLASICO", origen: { tipo: "propio" } });
      expect(efectiva?.aspecto.superficie).toEqual({
        valor: ASPECTO_POR_DEFECTO.superficie,
        origen: { tipo: "defecto" },
      });
      expect(efectiva?.vocabulario).toEqual([
        { texto: "rol.gerente.nombre", valor: "Jefe", origen: { tipo: "propio" } },
      ]);
      expect(efectiva?.modulosIniciales).toEqual({ valor: ["caja"], origen: { tipo: "propio" } });
    });

    it("la nieta hereda de la hija y de la principal, y cada campo dice de cuál", async () => {
      const { efectiva } = await ficha(f.nieta);
      const deHija = { tipo: "heredado", marcaId: f.hija, marcaCodigo: "hija" };
      const dePrincipal = {
        tipo: "heredado",
        marcaId: f.principal,
        marcaCodigo: expect.any(String) as string,
      };
      expect(efectiva?.nombreVisible).toEqual({ valor: "Nieta", origen: { tipo: "propio" } });
      expect(efectiva?.tema).toEqual({
        primary: { valor: "#336699", origen: deHija },
        "on-primary": { valor: TEMA["on-primary"], origen: dePrincipal },
        secondary: { valor: TEMA.secondary, origen: dePrincipal },
        accent: { valor: TEMA.accent, origen: dePrincipal },
      });
      expect(efectiva?.aspecto).toEqual({
        estilo: { valor: "CLASICO", origen: dePrincipal },
        superficie: { valor: "CALIDA", origen: deHija },
        esquinas: { valor: ASPECTO_POR_DEFECTO.esquinas, origen: { tipo: "defecto" } },
        titulos: { valor: ASPECTO_POR_DEFECTO.titulos, origen: { tipo: "defecto" } },
        ingreso: { valor: ASPECTO_POR_DEFECTO.ingreso, origen: { tipo: "defecto" } },
      });
      expect(efectiva?.logo).toEqual({ valor: LOGO, origen: dePrincipal });
      expect(efectiva?.vocabulario).toEqual([
        { texto: "rol.gerente.nombre", valor: "Jefe", origen: dePrincipal },
        { texto: "rol.operador.nombre", valor: "Mozo", origen: deHija },
      ]);
      expect(efectiva?.modulosIniciales).toEqual({ valor: ["caja"], origen: dePrincipal });
    });

    it("el plan por defecto resuelto trae su código, su estado y la última versión publicada con su nombre comercial", async () => {
      const { efectiva } = await ficha(f.nieta);
      expect(efectiva?.planPorDefecto).toEqual({
        valor: {
          planId: f.planDeLaPrincipal,
          codigo: "plan-base",
          estado: "ACTIVO",
          ultimaVersion: {
            versionDePlanId: f.versionDelPlan,
            numero: 1,
            nombreComercial: "Plan Base",
          },
        },
        origen: {
          tipo: "heredado",
          marcaId: f.principal,
          marcaCodigo: expect.any(String) as string,
        },
      });
    });

    it("una marca ajena no hereda nada de la familia: sus colores sin definir quedan sin definir", async () => {
      const { efectiva } = await ficha(f.ajena);
      expect(efectiva?.tema.primary).toEqual({ valor: "#aa0000", origen: { tipo: "propio" } });
      expect(efectiva?.tema.accent).toEqual({ valor: null, origen: { tipo: "defecto" } });
      expect(efectiva?.logo).toEqual({ valor: null, origen: { tipo: "defecto" } });
      expect(efectiva?.modulosIniciales).toEqual({ valor: null, origen: { tipo: "defecto" } });
      expect(efectiva?.planPorDefecto).toEqual({ valor: null, origen: { tipo: "defecto" } });
      expect(efectiva?.vocabulario).toEqual([]);
    });

    it("la herencia es la de HOY: una versión programada del padre no cuenta hasta que empieza", async () => {
      const padre = await crearMarca(dueno, { codigo: codigoAlAzar("pa"), padre: f.principal });
      await crearVersionDeMarcaConfirmada(dueno, padre, {
        nombreVisible: "Padre dinámico",
        logo: "/marcas/padre/uno.png",
        desdeSegundos: -30,
      });
      await crearVersionDeMarcaConfirmada(dueno, padre, {
        nombreVisible: "Padre dinámico",
        logo: "/marcas/padre/dos.png",
        desdeSegundos: 3600,
      });
      const hija = await crearMarca(dueno, { codigo: codigoAlAzar("hd"), padre });
      await crearVersionDeMarcaConfirmada(dueno, hija, {
        nombreVisible: "Hija",
        desdeSegundos: -30,
      });
      const hoy = exito(await consultas.fichaDeMarca(comoAdminAhora(), { marcaId: hija }));
      expect(hoy.efectiva?.logo).toEqual({
        valor: "/marcas/padre/uno.png",
        origen: { tipo: "heredado", marcaId: padre, marcaCodigo: expect.any(String) as string },
      });
      // Dentro de dos horas la versión programada del padre ya rige, y la hija la hereda.
      const despues = enLaHora(new Date(Date.now() + 2 * 3_600_000));
      const manana = exito(await consultas.fichaDeMarca(despues, { marcaId: hija }));
      expect(manana.efectiva?.logo.valor).toBe("/marcas/padre/dos.png");
    });

    it("una marca sin versión vigente no tiene definición efectiva", async () => {
      const marca = await crearMarca(dueno, { codigo: codigoAlAzar("s"), padre: f.principal });
      const r = await ficha(marca);
      expect(r.efectiva).toBeNull();
      expect(r.borradorEfectivo).toBeNull();
      expect(r.puedeConfirmarse).toEqual({ ok: false, error: "SIN_BORRADOR" });
      expect(r.contraste).toBeNull();
    });
  });

  describe("el borrador efectivo, el contraste previo y «¿se puede confirmar?»", () => {
    /** Una marca hija de la hija (hereda tema y aspecto) con un borrador. */
    async function conBorrador(
      datos: Parameters<typeof crearBorradorDeMarca>[2],
      padre = f.hija,
    ): Promise<string> {
      const marca = await crearMarca(dueno, { codigo: codigoAlAzar("b"), padre });
      await crearBorradorDeMarca(dueno, marca, datos);
      return marca;
    }

    /** Lo que responde la confirmación REAL de ese borrador (reemplazando lo programado, ahora, con motivo). */
    async function confirmacionReal(marcaId: string) {
      const contexto = comoAdminAhora();
      return casos.confirmarVersionDeMarca(contexto, {
        claveDeIdempotencia: clave(),
        marcaId,
        vigenteDesde: contexto.ahora,
        motivo: "prueba de coincidencia",
        reemplazaProgramada: true,
      });
    }

    it("el borrador efectivo se resuelve contra las versiones vigentes de los ancestros, con su origen", async () => {
      const marca = await conBorrador({
        nombreVisible: "Con borrador",
        tema: { accent: "#0b6e4f" },
      });
      const r = await ficha(marca);
      expect(r.efectiva).toBeNull();
      expect(r.borradorEfectivo?.nombreVisible).toEqual({
        valor: "Con borrador",
        origen: { tipo: "propio" },
      });
      expect(r.borradorEfectivo?.tema.accent).toEqual({
        valor: "#0b6e4f",
        origen: { tipo: "propio" },
      });
      expect(r.borradorEfectivo?.tema.primary).toEqual({
        valor: "#336699",
        origen: { tipo: "heredado", marcaId: f.hija, marcaCodigo: "hija" },
      });
      expect(r.borradorEfectivo?.logo.origen).toEqual({
        tipo: "heredado",
        marcaId: f.principal,
        marcaCodigo: expect.any(String) as string,
      });
    });

    it("sin borrador: SIN_BORRADOR, sin contraste, y la confirmación real dice lo mismo", async () => {
      const marca = await crearMarca(dueno, { codigo: codigoAlAzar("sb"), padre: f.hija });
      await crearVersionDeMarcaConfirmada(dueno, marca, {
        nombreVisible: "Sin borrador",
        desdeSegundos: -30,
      });
      const r = await ficha(marca);
      expect(r.borradorEfectivo).toBeNull();
      expect(r.contraste).toBeNull();
      expect(r.puedeConfirmarse).toEqual({ ok: false, error: "SIN_BORRADOR" });
      expect(falla(await confirmacionReal(marca))).toEqual("SIN_BORRADOR");
    });

    it("un borrador incompleto da DEFINICION_INCOMPLETA con lo que falta, igual que la confirmación", async () => {
      const marca = await conBorrador({ tema: { accent: "#0b6e4f" } });
      const previsto = (await ficha(marca)).puedeConfirmarse;
      expect(previsto).toEqual({
        ok: false,
        error: { codigo: "DEFINICION_INCOMPLETA", faltan: ["nombre_visible"] },
      });
      expect(falla(await confirmacionReal(marca))).toEqual(previsto.ok ? null : previsto.error);
    });

    it("un acento ilegible da CONTRASTE_INSUFICIENTE con el par, y el contraste dice cuánto, contra la superficie HEREDADA", async () => {
      // La hija elige la superficie cálida: el fondo del acento es el de la cálida, no el blanco.
      const marca = await conBorrador({ nombreVisible: "Pálida", tema: { accent: "#949494" } });
      const r = await ficha(marca);
      expect(r.contraste?.map((c) => c.par)).toEqual([
        "on-primary/primary",
        "accent/fondo",
        "accent/superficie",
      ]);
      expect(r.contraste?.[0]).toMatchObject({
        razon: razonDeContraste("#ffffff", "#336699"),
        minimo: 4.5,
        cumple: true,
      });
      expect(r.contraste?.[1]).toMatchObject({
        razon: razonDeContraste("#949494", "#fbf7f1"),
        minimo: 3,
        cumple: false,
      });
      expect(r.contraste?.[2]).toMatchObject({
        razon: razonDeContraste("#949494", "#f3eadc"),
        minimo: 3,
        cumple: false,
      });
      expect(r.puedeConfirmarse).toEqual({
        ok: false,
        error: { codigo: "CONTRASTE_INSUFICIENTE", par: "accent/fondo" },
      });
      expect(falla(await confirmacionReal(marca))).toEqual({
        codigo: "CONTRASTE_INSUFICIENTE",
        par: "accent/fondo",
      });
    });

    it("un borrador que cambia la superficie cambia contra qué se mide el acento", async () => {
      // Con la neutra el #949494 llega sobre el fondo (3,03) pero no sobre la superficie.
      const marca = await conBorrador({
        nombreVisible: "Neutra",
        tema: { accent: "#949494" },
        aspecto: { superficie: "NEUTRA" },
      });
      const r = await ficha(marca);
      expect(r.contraste?.[1]).toMatchObject({
        razon: razonDeContraste("#949494", "#ffffff"),
        cumple: true,
      });
      expect(r.contraste?.[2]).toMatchObject({ cumple: false });
      expect(r.puedeConfirmarse).toEqual({
        ok: false,
        error: { codigo: "CONTRASTE_INSUFICIENTE", par: "accent/superficie" },
      });
    });

    it("un tema incompleto deja sin medir los pares a los que les falta un color", async () => {
      const ajena = await conBorrador({ nombreVisible: "Sin colores" }, f.ajena);
      const r = await ficha(ajena);
      // La ajena solo define `primary`: falta on-primary y accent.
      expect(r.contraste).toEqual([
        { par: "on-primary/primary", razon: null, minimo: 4.5, cumple: null },
        { par: "accent/fondo", razon: null, minimo: 3, cumple: null },
        { par: "accent/superficie", razon: null, minimo: 3, cumple: null },
      ]);
    });

    it("módulos iniciales fuera del plan y plan retirado, igual que la confirmación", async () => {
      const fuera = await conBorrador({ nombreVisible: "Fuera", modulosIniciales: ["ventas"] });
      const previstoFuera = (await ficha(fuera)).puedeConfirmarse;
      expect(previstoFuera).toEqual({
        ok: false,
        error: { codigo: "MODULO_INICIAL_FUERA_DEL_PLAN", modulo: "ventas" },
      });
      expect(falla(await confirmacionReal(fuera))).toEqual(
        previstoFuera.ok ? null : previstoFuera.error,
      );

      const planRetirable = await crearPlanPublicado(dueno, { modulos: ["caja"] });
      const retirado = await conBorrador({
        nombreVisible: "Retirado",
        planPorDefecto: planRetirable.plan,
        modulosIniciales: ["caja"],
      });
      expect((await ficha(retirado)).puedeConfirmarse).toEqual({ ok: true });
      await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [planRetirable.plan]);
      const previstoRetirado = (await ficha(retirado)).puedeConfirmarse;
      expect(previstoRetirado).toEqual({ ok: false, error: "PLAN_POR_DEFECTO_RETIRADO" });
      expect(falla(await confirmacionReal(retirado))).toBe("PLAN_POR_DEFECTO_RETIRADO");
    });

    it("un borrador válido se puede confirmar, y la confirmación real lo confirma", async () => {
      const marca = await conBorrador({ nombreVisible: "Válida", tema: { accent: "#0b6e4f" } });
      const r = await ficha(marca);
      expect(r.puedeConfirmarse).toEqual({ ok: true });
      expect(r.contraste?.every((c) => c.cumple === true)).toBe(true);
      expect(exito(await confirmacionReal(marca))).toEqual({ numero: 1 });
    });

    it("no mira motivo, vigencia ni lo programado: una programada pendiente no impide el «sí» pero la confirmación sin reemplazarla sí", async () => {
      const marca = await crearMarca(dueno, { codigo: codigoAlAzar("pp"), padre: f.hija });
      await crearVersionDeMarcaConfirmada(dueno, marca, {
        nombreVisible: "Hoy",
        desdeSegundos: -30,
      });
      await crearVersionDeMarcaConfirmada(dueno, marca, {
        nombreVisible: "Mañana",
        desdeSegundos: 3600,
      });
      await crearBorradorDeMarca(dueno, marca, { nombreVisible: "Pasado" });
      expect((await ficha(marca)).puedeConfirmarse).toEqual({ ok: true });
      const contexto = comoAdminAhora();
      const sinReemplazar = await casos.confirmarVersionDeMarca(contexto, {
        claveDeIdempotencia: clave(),
        marcaId: marca,
        vigenteDesde: contexto.ahora,
        motivo: "x",
        reemplazaProgramada: false,
      });
      expect(falla(sinReemplazar)).toBe("CAMBIO_PROGRAMADO_PENDIENTE");
    });

    it("la ficha solo lee: no escribe, no audita y no toca claves de idempotencia", async () => {
      const antes = await huellaDeEscrituras(dueno);
      await ficha(f.nieta);
      await ficha(f.principal);
      expect(await huellaDeEscrituras(dueno)).toEqual(antes);
    });
  });
});

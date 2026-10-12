import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CATALOGO_DE_MODULOS,
  type CatalogoComercial,
  type ClaveAccion,
  type ClaveCapacidad,
  type ClaveModulo,
} from "../../src/capacidades/modulos/catalogo";
import { REGLAS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import { evaluarGuard } from "../../src/capacidades/permisos/guard";
import type { RolDeEmpresa } from "../../src/capacidades/permisos/roles";
import type { ContextoDePlataforma, ContextoOperativo } from "../../src/contexto/contexto";
import type { CargaDeAutorizacion } from "../../src/puertos/autorizacion";
import {
  type DECLARACIONES_DE_IDENTIDAD,
  crearCasosDeUsoDeIdentidad,
  type DeclaracionDeCaso,
} from "../../src/modulos/identidad/publico";

/**
 * P5: lo que NO debe compilar. Cada `@ts-expect-error` es una promesa del sistema de tipos: si el
 * compilador dejara de rechazar la línea, el propio `@ts-expect-error` fallaría en `npm run typecheck`
 * (que incluye `test/`). Nada de esto se ejecuta: son funciones que nadie llama.
 */

describe("tipos cerrados derivados del catálogo", () => {
  it("las claves salen del catálogo real", () => {
    expectTypeOf<ClaveModulo>().toEqualTypeOf<"administracion">();
    expectTypeOf<ClaveAccion>().toEqualTypeOf<
      "usuarios.invitar" | "usuarios.reenviar_invitacion" | "usuarios.apagar"
    >();
    // Hoy ninguna acción exige una capacidad de sucursal.
    expectTypeOf<ClaveCapacidad>().toEqualTypeOf<never>();
    expectTypeOf<RolDeEmpresa>().toEqualTypeOf<"GERENTE" | "ADMINISTRADOR" | "OPERADOR">();
  });

  it("una acción que no existe en el catálogo no compila", () => {
    const datos = {
      rol: "GERENTE",
      modulosActivos: new Set<ClaveModulo>(["administracion"]),
      capacidadesDeSucursal: null,
    } as const;
    const noSeEjecuta = () => {
      // @ts-expect-error la acción "gestion_usuarios" (el nombre viejo, sin granularidad) no existe
      evaluarGuard(REGLAS_DE_EMPRESA, "gestion_usuarios", datos);
      // @ts-expect-error tampoco una acción inventada
      evaluarGuard(REGLAS_DE_EMPRESA, "usuarios.borrar_todo", datos);
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });

  it("una matriz a la que le falta una acción, o le sobra una, o trae un rol inexistente, no compila", () => {
    const matriz = (permisos: ReglasDeEmpresa["permisos"]) => permisos;
    const sinUnaAccion = () =>
      // @ts-expect-error falta "usuarios.apagar"
      matriz({ "usuarios.invitar": ["GERENTE"], "usuarios.reenviar_invitacion": ["GERENTE"] });
    const conAccionDeMas = () =>
      matriz({
        "usuarios.invitar": ["GERENTE"],
        "usuarios.reenviar_invitacion": ["GERENTE"],
        "usuarios.apagar": ["GERENTE"],
        // @ts-expect-error esa acción no existe en el catálogo
        "usuarios.borrar_todo": ["GERENTE"],
      });
    const conRolInexistente = () =>
      matriz({
        "usuarios.invitar": ["GERENTE"],
        "usuarios.reenviar_invitacion": ["GERENTE"],
        // @ts-expect-error "SUPERVISOR" no es un rol de empresa
        "usuarios.apagar": ["SUPERVISOR"],
      });
    expect([sinUnaAccion, conAccionDeMas, conRolInexistente]).toHaveLength(3);
  });

  it("un módulo del catálogo con una forma incompleta no compila", () => {
    // @ts-expect-error al módulo le faltan estado, obligatorio, requiere, etc.
    const incompleto: CatalogoComercial = { sin_ficha: { acciones: {} } };
    expect(incompleto).toBeDefined();
    expect(Object.keys(CATALOGO_DE_MODULOS)).toEqual(["administracion"]);
  });
});

describe("la carga de autorización solo acepta el contexto operativo", () => {
  it("un contexto de plataforma, de grupo, de trabajos o de invitación no compila", () => {
    const noSeEjecuta = async (
      carga: CargaDeAutorizacion,
      operativo: ContextoOperativo,
      plataforma: ContextoDePlataforma,
    ) => {
      await carga.delActor(operativo);
      // @ts-expect-error un administrador de plataforma no es un actor de empresa
      await carga.delActor(plataforma);
      // @ts-expect-error ni el cron de trabajos
      await carga.delActor({ tipo: "TRABAJOS", ahora: new Date(0) });
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});

describe("los casos de uso deben estar declarados", () => {
  type Casos = ReturnType<typeof crearCasosDeUsoDeIdentidad>;

  it("los casos de uso y sus declaraciones son exactamente los mismos", () => {
    expectTypeOf<keyof Casos>().toEqualTypeOf<keyof typeof DECLARACIONES_DE_IDENTIDAD>();
  });

  it("un caso de uso sin declarar, o una declaración sin caso de uso, no compila (el patrón de casos-de-uso.ts)", () => {
    const exacto = (casos: Record<keyof typeof DECLARACIONES_DE_IDENTIDAD, unknown>) => casos;
    const sinDeclarar = () =>
      exacto({
        aceptarInvitacion: 1,
        invitarUsuario: 1,
        apagarMembresia: 1,
        reenviarInvitacion: 1,
        // @ts-expect-error un caso de uso nuevo sin entrada en DECLARACIONES
        nuevoCaso: 1,
      });
    const sinCaso = () =>
      // @ts-expect-error una declaración sin caso de uso (falta reenviarInvitacion)
      exacto({ aceptarInvitacion: 1, invitarUsuario: 1, apagarMembresia: 1 });
    expect([sinDeclarar, sinCaso]).toHaveLength(2);
  });

  it("una declaración con una acción que no existe, o ni acción ni motivo, no compila", () => {
    // @ts-expect-error esa acción no existe en el catálogo
    const inventada: DeclaracionDeCaso = { accion: "usuarios.borrar_todo" };
    // @ts-expect-error ni acción ni motivo de no pasar por el guard
    const vacia: DeclaracionDeCaso = {};
    expect([inventada, vacia]).toHaveLength(2);
  });

  it("sin `reglas` el guard no tiene con qué autorizar: no compila", () => {
    const noSeEjecuta = (dependencias: Parameters<typeof crearCasosDeUsoDeIdentidad>[0]) => {
      const { transacciones, tokens } = dependencias;
      // @ts-expect-error falta `reglas`
      return crearCasosDeUsoDeIdentidad({ transacciones, tokens });
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});

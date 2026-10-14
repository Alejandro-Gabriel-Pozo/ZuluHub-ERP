import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CATALOGO_DE_MODULOS,
  type CatalogoComercial,
  type DefinicionDeAccion,
  type EfectoDeAccion,
  type ClaveAccion,
  type ClaveCapacidad,
  type ClaveModulo,
} from "../../src/capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../src/capacidades/permisos/empresa";
import { evaluarGuard, type MotivoDeRechazo } from "../../src/capacidades/permisos/guard";
import {
  CATALOGO_DE_PLATAFORMA,
  PERMISOS_DE_PLATAFORMA,
  REGLAS_DE_PLATAFORMA,
  type ClaveAccionDePlataforma,
  type ClaveCapacidadDePlataforma,
  type ClaveModuloDePlataforma,
  type ReglasDePlataforma,
  type RolDePlataforma,
} from "../../src/capacidades/permisos/plataforma";
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
    expectTypeOf<ClaveModulo>().toEqualTypeOf<
      "administracion" | "facturacion" | "catalogo" | "carta" | "stock"
    >();
    expectTypeOf<ClaveAccion>().toEqualTypeOf<
      | "usuarios.invitar"
      | "usuarios.reenviar_invitacion"
      | "usuarios.apagar"
      | "usuarios.ver"
      | "usuarios.asignar_sucursales"
      | "usuarios.revocar_invitacion"
      | "sucursales.ver"
      | "sucursales.crear"
      | "sucursales.editar"
      | "sucursales.desactivar"
      | "sucursales.reactivar"
      | "gerencia.proponer_traspaso"
      | "gerencia.cancelar_traspaso"
      | "gerencia.ver_traspaso"
      | "gerencia.aceptar_traspaso"
      | "gerencia.rechazar_traspaso"
      | "modulos.ver"
      | "permisos.ver_propios"
      | "comprobantes.emitir"
      | "comprobantes.ver"
      | "comprobantes.emitir_manual"
      | "notas_de_credito.emitir"
      | "comprobantes.descartar"
      | "comprobantes.reintentar"
      | "series.resincronizar"
      | "puntos_de_venta.cambiar_ambiente"
      | "certificados.gestionar"
      | "productos.ver"
      | "productos.crear"
      | "productos.editar"
      | "productos.reactivar"
      | "productos.cambiar_precio"
      | "productos.desactivar"
      | "productos.asignar_emisor"
      | "opciones.editar"
      | "categorias.crear"
      | "categorias.editar"
      | "categorias.reactivar"
      | "categorias.desactivar"
      | "variantes.editar"
      | "opciones.asignar"
      | "grupos_de_precio.crear"
      | "grupos_de_precio.editar"
      | "grupos_de_precio.asignar"
      | "grupos_de_precio.reactivar"
      | "grupos_de_precio.desactivar"
      | "combos.editar_contenido"
      | "cartas.ver"
      | "cartas.marcar_disponibilidad"
      | "cartas.crear"
      | "cartas.editar"
      | "cartas.publicar"
      | "cartas.retirar"
      | "cartas.publicar_en_linea"
      | "cartas.renovar_enlace"
      | "cartas.retirar_de_linea"
      | "stock.ver"
      | "stock.verificar_saldos"
      | "stock.registrar_entrada"
      | "stock.registrar_salida"
      | "stock.transferir"
      | "stock.ajustar"
      | "stock.anular"
      | "depositos.crear"
      | "depositos.editar"
      | "depositos.reactivar"
      | "depositos.desactivar"
      | "depositos.asignar_emisor"
      | "articulos.controlar"
      | "articulos.dejar_de_controlar"
      | "recetas.editar"
      | "conteos.abrir"
      | "conteos.registrar"
      | "conteos.aplicar"
      | "conteos.cancelar"
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
    const sinUnaAccion: Omit<typeof PERMISOS_DE_EMPRESA, "usuarios.apagar"> = PERMISOS_DE_EMPRESA;
    const faltaUna = () =>
      // @ts-expect-error falta "usuarios.apagar"
      matriz(sinUnaAccion);
    const faltanLasNuevas = () =>
      // @ts-expect-error faltan todas las acciones que sumó H6
      matriz({
        "usuarios.invitar": ["GERENTE"],
        "usuarios.reenviar_invitacion": ["GERENTE"],
        "usuarios.apagar": ["GERENTE"],
      });
    const conAccionDeMas = () =>
      matriz({
        ...PERMISOS_DE_EMPRESA,
        // @ts-expect-error esa acción no existe en el catálogo
        "usuarios.borrar_todo": ["GERENTE"],
      });
    const conRolInexistente = () =>
      matriz({
        ...PERMISOS_DE_EMPRESA,
        // @ts-expect-error "SUPERVISOR" no es un rol de empresa
        "usuarios.apagar": ["SUPERVISOR"],
      });
    expect([faltaUna, faltanLasNuevas, conAccionDeMas, conRolInexistente]).toHaveLength(4);
  });

  it("un módulo del catálogo con una forma incompleta no compila", () => {
    // @ts-expect-error al módulo le faltan estado, obligatorio, requiere, etc.
    const incompleto: CatalogoComercial = { sin_ficha: { acciones: {} } };
    expect(incompleto).toBeDefined();
    expect(Object.keys(CATALOGO_DE_MODULOS)).toEqual([
      "administracion",
      "facturacion",
      "catalogo",
      "carta",
      "stock",
    ]);
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
        revocarInvitacion: 1,
        asignarSucursales: 1,
        proponerTraspaso: 1,
        cancelarTraspaso: 1,
        aceptarTraspaso: 1,
        rechazarTraspaso: 1,
        // @ts-expect-error un caso de uso nuevo sin entrada en DECLARACIONES
        nuevoCaso: 1,
      });
    const sinCaso = () =>
      // @ts-expect-error una declaración sin caso de uso (faltan todos menos tres)
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

describe("H5 P1: los tipos de plataforma salen de su catálogo y no se mezclan con los de empresa", () => {
  it("las claves y los roles de plataforma son exactamente estos", () => {
    expectTypeOf<ClaveModuloDePlataforma>().toEqualTypeOf<"plataforma">();
    expectTypeOf<ClaveAccionDePlataforma>().toEqualTypeOf<
      | "tenants.ver"
      | "empresas.ver"
      | "invitaciones.ver"
      | "trabajos.ver_fallidos"
      | "auditoria.ver"
      | "configuracion.ver"
      | "soporte.buscar_referencia"
      | "soporte.explicar"
      | "altas.reenviar_invitacion"
      | "altas.revocar_invitacion"
      | "empresas.alta"
      | "altas.cancelar"
      | "tenants.suspender"
      | "tenants.reactivar"
      | "empresas.suspender"
      | "empresas.reactivar"
      | "personas.suspender"
      | "personas.reactivar"
      | "marcas.ver"
      | "planes.ver"
      | "marcas.crear"
      | "marcas.editar_borrador"
      | "marcas.confirmar_version"
      | "dominios.agregar"
      | "dominios.retirar"
      | "dominios.verificar"
      | "dominios.activar"
      | "dominios.desactivar"
      | "planes.crear"
      | "planes.editar_borrador"
      | "planes.publicar_version"
      | "planes.asignar"
      | "perillas.ajustar"
      | "modulos_de_empresa.activar"
      | "modulos_de_empresa.desactivar"
    >();
    expectTypeOf<ClaveCapacidadDePlataforma>().toEqualTypeOf<never>();
    expectTypeOf<RolDePlataforma>().toEqualTypeOf<"ADMIN" | "SOPORTE">();
  });

  it("el rol de plataforma y el de empresa son tipos distintos y disjuntos", () => {
    expectTypeOf<RolDePlataforma>().not.toMatchTypeOf<RolDeEmpresa>();
    expectTypeOf<RolDeEmpresa>().not.toMatchTypeOf<RolDePlataforma>();
    expectTypeOf<Extract<RolDePlataforma, RolDeEmpresa>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<ClaveAccionDePlataforma, ClaveAccion>>().toEqualTypeOf<never>();
  });

  it("una acción de plataforma en el guard de empresa no compila, y una de empresa en el de plataforma tampoco", () => {
    const datosDeEmpresa = {
      rol: "GERENTE",
      modulosActivos: new Set<ClaveModulo>(["administracion"]),
      capacidadesDeSucursal: null,
    } as const;
    const datosDePlataforma = {
      rol: "ADMIN",
      modulosActivos: new Set<ClaveModuloDePlataforma>(["plataforma"]),
      capacidadesDeSucursal: null,
    } as const;
    const noSeEjecuta = () => {
      // @ts-expect-error "empresas.alta" es una acción de plataforma, no de empresa
      evaluarGuard(REGLAS_DE_EMPRESA, "empresas.alta", datosDeEmpresa);
      // @ts-expect-error "usuarios.invitar" es una acción de empresa, no de plataforma
      evaluarGuard(REGLAS_DE_PLATAFORMA, "usuarios.invitar", datosDePlataforma);
      // Las propias sí compilan.
      evaluarGuard(REGLAS_DE_EMPRESA, "usuarios.invitar", datosDeEmpresa);
      evaluarGuard(REGLAS_DE_PLATAFORMA, "empresas.alta", datosDePlataforma);
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });

  it("un rol de plataforma en el guard de empresa no compila, y uno de empresa en el de plataforma tampoco", () => {
    const noSeEjecuta = () => {
      evaluarGuard(REGLAS_DE_EMPRESA, "usuarios.invitar", {
        // @ts-expect-error "SOPORTE" no es un rol de empresa
        rol: "SOPORTE",
        modulosActivos: new Set<ClaveModulo>(["administracion"]),
        capacidadesDeSucursal: null,
      });
      evaluarGuard(REGLAS_DE_PLATAFORMA, "empresas.alta", {
        // @ts-expect-error "GERENTE" no es un rol de plataforma
        rol: "GERENTE",
        modulosActivos: new Set<ClaveModuloDePlataforma>(["plataforma"]),
        capacidadesDeSucursal: null,
      });
      evaluarGuard(REGLAS_DE_PLATAFORMA, "empresas.alta", {
        // @ts-expect-error tampoco un texto cualquiera
        rol: "SUPERUSUARIO",
        modulosActivos: new Set<ClaveModuloDePlataforma>(["plataforma"]),
        capacidadesDeSucursal: null,
      });
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });

  it("los módulos activos de empresa no sirven para el guard de plataforma", () => {
    const noSeEjecuta = () =>
      evaluarGuard(REGLAS_DE_PLATAFORMA, "empresas.alta", {
        rol: "ADMIN",
        // @ts-expect-error "administracion" no es un módulo de plataforma
        modulosActivos: new Set<ClaveModulo>(["administracion"]),
        capacidadesDeSucursal: null,
      });
    expect(noSeEjecuta).toBeTypeOf("function");
  });

  it("una matriz de plataforma a la que le falta una acción, le sobra una o trae un rol inexistente, no compila", () => {
    const matriz = (permisos: ReglasDePlataforma["permisos"]) => permisos;
    const sinUnaAccion: Omit<typeof PERMISOS_DE_PLATAFORMA, "empresas.alta"> =
      PERMISOS_DE_PLATAFORMA;
    const faltaUna = () =>
      // @ts-expect-error falta "empresas.alta"
      matriz(sinUnaAccion);
    const conAccionDeMas = () =>
      matriz({
        ...PERMISOS_DE_PLATAFORMA,
        // @ts-expect-error esa acción no existe en el catálogo de plataforma
        "empresas.borrar_todo": ["ADMIN"],
      });
    const conRolDeEmpresa = () =>
      matriz({
        ...PERMISOS_DE_PLATAFORMA,
        // @ts-expect-error "GERENTE" no es un rol de plataforma
        "empresas.alta": ["GERENTE"],
      });
    const conRolInexistente = () =>
      matriz({
        ...PERMISOS_DE_PLATAFORMA,
        // @ts-expect-error "SUPERADMIN" no es un rol de plataforma
        "empresas.alta": ["SUPERADMIN"],
      });
    expect([faltaUna, conAccionDeMas, conRolDeEmpresa, conRolInexistente]).toHaveLength(4);
  });

  it("un módulo de plataforma con una forma incompleta no compila", () => {
    // @ts-expect-error al módulo le faltan estado, obligatorio, requiere, etc.
    const incompleto: CatalogoComercial = { plataforma: { acciones: {} } };
    expect(incompleto).toBeDefined();
    expect(Object.keys(CATALOGO_DE_PLATAFORMA)).toEqual(["plataforma"]);
  });
});

describe("solo lectura (corrección 16): toda acción declara su efecto", () => {
  it("los motivos del guard son exactamente estos cinco", () => {
    expectTypeOf<MotivoDeRechazo>().toEqualTypeOf<
      | "MODULO_EN_DESARROLLO"
      | "MODULO_NO_ACTIVO"
      | "MODULO_EN_SOLO_LECTURA"
      | "SIN_CAPACIDAD"
      | "SIN_PERMISO"
    >();
  });

  it("los efectos posibles son exactamente tres", () => {
    expectTypeOf<EfectoDeAccion>().toEqualTypeOf<"LECTURA" | "CREA_AMPLIA" | "COMPLETA_CIERRA">();
  });

  it("el efecto de cada acción real queda como literal, no como texto cualquiera", () => {
    const empresa = CATALOGO_DE_MODULOS.administracion.acciones;
    expectTypeOf(empresa["usuarios.invitar"].efecto).toEqualTypeOf<"CREA_AMPLIA">();
    expectTypeOf(empresa["usuarios.apagar"].efecto).toEqualTypeOf<"COMPLETA_CIERRA">();
    expectTypeOf(empresa["usuarios.ver"].efecto).toEqualTypeOf<"LECTURA">();
    const plataforma = CATALOGO_DE_PLATAFORMA.plataforma.acciones;
    expectTypeOf(plataforma["empresas.alta"].efecto).toEqualTypeOf<"CREA_AMPLIA">();
    expectTypeOf(plataforma["empresas.suspender"].efecto).toEqualTypeOf<"COMPLETA_CIERRA">();
    expectTypeOf(plataforma["empresas.ver"].efecto).toEqualTypeOf<"LECTURA">();
  });

  it("una acción sin efecto, o con un efecto inexistente, no compila", () => {
    // @ts-expect-error falta `efecto`: una acción nueva no puede quedar sin clasificar
    const sinEfecto: DefinicionDeAccion = { capacidad: null };
    // @ts-expect-error "ESCRITURA" no es un efecto (el viejo booleano de lectura tampoco)
    const inventado: DefinicionDeAccion = { capacidad: null, efecto: "ESCRITURA" };
    // @ts-expect-error el booleano `lectura` que reemplaza `efecto` ya no existe
    const booleano: DefinicionDeAccion = { capacidad: null, lectura: true };
    expect([sinEfecto, inventado, booleano]).toHaveLength(3);
  });

  it("un módulo del catálogo con una acción sin efecto no compila", () => {
    const base = {
      estado: "disponible",
      obligatorio: false,
      requiere: [],
      usaSiExiste: [],
      datosRequeridos: [],
      implementadoPor: [],
    } as const;
    const catalogo: CatalogoComercial = {
      completo: { ...base, acciones: { "completo.ver": { capacidad: null, efecto: "LECTURA" } } },
      incompleto: {
        ...base,
        // @ts-expect-error la acción "incompleto.ver" no declara su efecto
        acciones: { "incompleto.ver": { capacidad: null } },
      },
    };
    expect(Object.keys(catalogo)).toEqual(["completo", "incompleto"]);
  });

  it("el guard acepta como solo lectura únicamente módulos del catálogo", () => {
    const noSeEjecuta = () => {
      evaluarGuard(REGLAS_DE_EMPRESA, "usuarios.invitar", {
        rol: "GERENTE",
        modulosActivos: new Set<ClaveModulo>(["administracion"]),
        modulosEnSoloLectura: new Set<ClaveModulo>(["administracion"]),
        capacidadesDeSucursal: null,
      });
      evaluarGuard(REGLAS_DE_EMPRESA, "usuarios.invitar", {
        rol: "GERENTE",
        modulosActivos: new Set<ClaveModulo>(["administracion"]),
        // @ts-expect-error "plataforma" no es un módulo de empresa
        modulosEnSoloLectura: new Set<ClaveModuloDePlataforma>(["plataforma"]),
        capacidadesDeSucursal: null,
      });
    };
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});

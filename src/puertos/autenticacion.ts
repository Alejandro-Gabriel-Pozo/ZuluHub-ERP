import type { EstadoDeSesionDePlataforma } from "../capacidades/autenticacion/estado-de-sesion-de-plataforma";
import type { UsuarioAuthId } from "../primitivas/identificadores/marca";

/**
 * Puertos de la autenticación (web-armazon §3.1 y §4). Tipos puros: ni la librería de ingreso ni la
 * herramienta de datos aparecen acá. La web usa estos puertos; el adaptador (`adaptadores/autenticacion`)
 * los cumple con Better Auth y la composición lo arma.
 */

/** Lo único que la autenticación necesita de un pedido para saber quién es: sus encabezados (la cookie). */
export type PedidoDeSesion = Readonly<{ headers: Headers }>;

/**
 * Quién es la persona que hace el pedido, según la sesión de ESTE host. Solo identidad: nada de negocio
 * (la persona y las empresas salen después, con el contexto `SESION`). El email es el verificado por el
 * proveedor y el que se compara con el de una invitación.
 */
export type SesionAutenticada = Readonly<{
  usuarioAuth: UsuarioAuthId;
  email: string;
  /** Siempre `true` hoy (se rechaza el ingreso sin email verificado); el campo deja la garantía a la vista. */
  emailVerificado: boolean;
  creadaEn: Date;
  /** Cuándo se usó por última vez, para el aviso de inactividad de la pantalla. */
  ultimoUso: Date;
  /** Cuándo vence si no se usa más. */
  venceEn: Date;
  /**
   * Cuándo se verificó el segundo factor EN ESTA SESIÓN (solo la consola de plataforma; en la de empresa no hay
   * segundo factor y el campo falta). `null`: todavía no se verificó. Lo exige `contextoDePlataformaDeLaSesion` (P8b).
   */
  segundoFactorEn?: Date | null;
  /**
   * Solo la consola de plataforma: el host en el que nació la sesión (el mismo con el que se pidió; vacío si no se
   * sabe). La puerta de la consola lo vuelve a comparar con el suyo: una sesión de otro host no entra.
   */
  host?: string;
  /**
   * Solo la consola: si el usuario ya tiene el segundo factor enrolado y verificado. Con `segundoFactorEn` nulo decide
   * si se informa «verificar» o «enrolar»; nunca deja entrar.
   */
  segundoFactorEnrolado?: boolean;
  /**
   * `Set-Cookie` que dejó la renovación de la sesión (el navegador solo se entera de la renovación si
   * la respuesta los lleva). Vacío si no hubo. Un componente de servidor no puede fijar cookies: lo
   * aplican la acción del servidor o el manejador de ruta que sí pueden.
   */
  cookiesDeRespuesta: readonly string[];
}>;

export interface Autenticacion {
  /**
   * La sesión del pedido en el `host` indicado (el que resolvió la puerta para este mismo pedido), o
   * `null`: sin cookie, cookie inválida, sesión vencida (15 minutos sin uso u 8 horas de creada) o
   * sesión creada en OTRO host (una cookie copiada de una marca no vale en otra, G4). Si la sesión es
   * válida la renueva (cuenta como uso). Nunca lanza por una sesión mala: lanza solo si la base falla.
   */
  sesionDe(pedido: PedidoDeSesion, host: string): Promise<SesionAutenticada | null>;

  /**
   * Atiende un pedido a `/api/auth/*` (ingreso con Google, retorno, leer sesión, cerrar sesión) para el
   * `host` indicado. Solo deja pasar las rutas de la lista cerrada; el resto responde 404 neutro. Las
   * redirecciones de error salen con un código público de la lista cerrada y sin descripción.
   */
  manejar(pedido: Request, host: string): Promise<Response>;
}

/**
 * La consola de plataforma (h5-p8). Lo mismo que la web de empresa más el estado de la sesión, que la pantalla usa
 * para avisar antes de que venza y para pedir el código cuando el segundo factor ya es viejo.
 */
export interface AutenticacionDePlataforma extends Autenticacion {
  /**
   * El estado de la sesión del pedido en `host`, SIN renovarla (mirarla no cuenta como uso; renovar es
   * `GET /api/auth/get-session`). Nunca lanza por una sesión mala: devuelve `vigente: false`.
   */
  estadoDeSesion(pedido: PedidoDeSesion, host: string): Promise<EstadoDeSesionDePlataforma>;
}

/**
 * ¿Ese email es el de personal de la plataforma habilitado (administrador activo)? Lo implementa un adaptador sobre
 * la conexión de plataforma: la librería de ingreso corre con un rol que no ve `admin_plataforma`. `false` ante
 * cualquier duda (email que no es de un administrador, administrador dado de baja).
 */
export interface PersonalHabilitado {
  esHabilitado(email: string): Promise<boolean>;
}

export type ResumenDelBarrido = Readonly<{
  sesiones: number;
  verificaciones: number;
  limitesDePedidos: number;
}>;

export interface BarridoDeAutenticacion {
  /**
   * Borra lo vencido a `ahora`: sesiones (por vencimiento, por inactividad o por pasar el tope absoluto),
   * verificaciones y contadores de límite de pedidos que ya no cuentan. Una transacción corta y con tope
   * de filas por pasada. Idempotente: repetirlo no borra de más y no falla; devuelve cuántas filas
   * borró (si llegó al tope, la próxima pasada sigue).
   */
  barrerVencidos(ahora: Date): Promise<ResumenDelBarrido>;
}

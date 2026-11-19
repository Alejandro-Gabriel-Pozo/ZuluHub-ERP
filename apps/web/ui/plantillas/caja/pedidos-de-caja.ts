/**
 * Los pedidos de las acciones de la pantalla «Caja» del mostrador: de lo que se escribió en pantalla a lo que declara la frontera del servidor (`entradas-de-sesion-de-caja.ts`). Puros: sin React.
 * Solo viaja lo que la frontera lee: la empresa, la persona y la sucursal no van (las pone el servidor). El dinero viaja como TEXTO decimal sin signo. Cada acción que escribe lleva la clave
 * de idempotencia del intento (`useEnvioConClave`): repetirla no duplica. La pantalla no valida el negocio: el servidor decide.
 */
export const armarElPedidoDeApertura = (
  claveDeIdempotencia: string,
  cajaId: string,
  fondoInicial: string,
) => ({ claveDeIdempotencia, cajaId, fondoInicial });

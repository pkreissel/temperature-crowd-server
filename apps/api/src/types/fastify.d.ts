import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    donor?: {
      id: string;
    };
  }
}

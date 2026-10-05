-- pg_net: асинхронные HTTP-запросы из БД (вызов Edge Functions по событиям)
create extension if not exists pg_net with schema extensions;

import { createContext, useContext, useState, type ReactNode } from 'react'

// Все тексты интерфейса — только здесь. Казахский перевод требует вычитки носителем.
const ru = {
  'app.slogan': 'Наряд выдан — ИИ на контроле',
  'login.tab': 'Табельный номер',
  'login.pin': 'ПИН-код',
  'login.submit': 'Войти',
  'login.error': 'Неверный табельный номер или ПИН',
  'login.no_employee': 'Учётная запись не привязана к сотруднику',
  'nav.logout': 'Выйти', 'nav.back': 'Назад', 'nav.notifications': 'Уведомления',
  'role.master': 'Мастер смены', 'role.worker': 'Исполнитель', 'role.manager': 'Руководитель', 'role.admin': 'Администратор',

  'status.issued': 'Выдан', 'status.accepted': 'Принят', 'status.queued': 'В очереди', 'status.rejected': 'Отклонён',
  'status.in_progress': 'В работе', 'status.paused': 'Приостановлен', 'status.done': 'Исполнено',
  'status.ai_review': 'Проверка ИИ', 'status.rework': 'На доработке', 'status.closed': 'Закрыт', 'status.cancelled': 'Отменён',
  'priority.emergency': 'Аварийный', 'priority.high': 'Высокий', 'priority.normal': 'Обычный', 'priority.planned': 'Плановый',
  'live.free': 'Свободен', 'live.busy': 'Выполняет №{n}', 'live.queue': 'В очереди: {n}', 'live.off_shift': 'Не на смене',

  'col.issued': 'Выданные', 'col.accepted': 'Принятые', 'col.in_progress': 'В работе',
  'col.queued': 'В очереди', 'col.done': 'Выполненные', 'col.overdue': 'Просроченные',
  'board.title': 'Смена', 'board.people': 'Исполнители', 'board.new': '+ Новый наряд',
  'board.counters.open': 'Открыто', 'board.counters.done': 'На проверке', 'board.counters.overdue': 'Просрочено',
  'board.counters.downtime': 'Оборудование в простое',
  'board.empty': 'Пусто', 'board.free_of': 'свободно из', 'board.toggle_shift': 'Нажмите, чтобы отметить «на смене / не на смене»',
  'board.search': 'Поиск: оборудование, исполнитель, №', 'board.all_priorities': 'Все приоритеты', 'board.created': 'Наряд №{n} выдан',

  'action.accept': 'Принять в работу', 'action.queue': 'В очередь', 'action.reject': 'Отклонить',
  'action.start': 'Начать исполнение', 'action.pause': 'Приостановить', 'action.complete': 'Исполнено',
  'reason.title': 'Укажите причину', 'reason.cancel': 'Отмена',
  'reason.no_materials': 'Нет материалов', 'reason.no_permit': 'Нет допуска', 'reason.busy_emergency': 'Занят аварийным нарядом',
  'reason.wait_parts': 'Ждёт запчасти', 'reason.wait_stop': 'Ждёт остановки оборудования', 'reason.wait_permit': 'Ждёт допуска',
  'worker.title': 'Мои наряды', 'worker.empty': 'Нарядов нет', 'worker.due': 'Срок', 'worker.overdue': 'Просрочен',
  'worker.my_scores': 'Мои закрытые наряды и оценки',

  'order.new': 'Новый наряд', 'order.title': 'Наряд', 'order.assignee': 'Исполнитель', 'order.master': 'Мастер',
  'order.fact': 'Факт', 'order.downtime': 'Простой', 'order.photos': 'Фото', 'order.photo_before': 'До (неисправность)',
  'order.photo_after': 'После (результат)', 'order.timeline': 'Хронология', 'order.rework_count': 'Доработок',

  'form.equipment': 'Оборудование', 'form.site': 'Участок', 'form.choose_equipment': 'Выберите оборудование',
  'form.description': 'Описание проблемы и работ', 'form.description_ph': 'Скажите или напишите, что случилось',
  'form.priority': 'Приоритет', 'form.assignee': 'Исполнитель', 'form.ai_assignee': 'ИИ подобрал: свободен, нужная специальность, лучшая оценка по этому оборудованию',
  'form.all_workers': 'Все исполнители', 'form.due': 'Срок', 'form.by_norm': 'По нормативу', 'form.due_exact': 'Точный срок',
  'form.norm': 'норматив', 'form.ai_code': 'ИИ: шифр', 'form.photos_before': 'Фото неисправности (до 5)', 'form.photo': 'Фото',
  'form.comment': 'Комментарий', 'form.issue': 'Выдать наряд', 'form.sending': 'Отправка…', 'form.voice': 'Голосовой ввод',
  'form.photo_error': 'Наряд выдан, но фото не загрузилось',

  'close.work': 'Выполненные работы', 'close.work_ph': 'Что сделано — голосом или текстом', 'close.code': 'Шифр неисправности',
  'close.materials': 'Списанные материалы', 'close.search_material': 'Найти материал…', 'close.photo_after': 'Фото «после»',
  'close.photo_required': 'Обязательно для внеплановых работ', 'close.submit': 'Закрыть наряд',
  'close.no_photo_title': 'Нет фото «после»', 'close.no_photo_text': 'Для внепланового наряда фото обязательно. Без него ИИ вернёт наряд на доработку.',
  'close.add_photo': 'Сделать фото', 'close.send_anyway': 'Отправить без фото',

  'ai.check': 'Проверка ИИ', 'ai.checking': 'ИИ проверяет наряд…', 'ai.not_yet': 'Проверка начнётся после «Исполнено»',
  'ai.confidence': 'уверенность', 'ai.master_changed': 'оценка изменена мастером', 'ai.ai_score': 'ИИ',
  'ai.rules_mode': 'Режим правил: Claude не подключён.', 'ai.thinking': 'ИИ готовит сводку…',
  'verdict.accepted': 'Принято', 'verdict.accepted_with_remarks': 'Принято с замечаниями', 'verdict.rework': 'Требует доработки',
  'verdict.needs_master_review': 'Нужна проверка мастером',
  'master.approve': 'Подтвердить и закрыть', 'master.return': 'Вернуть на доработку', 'master.return_ph': 'Что нужно исправить',
  'master.final_score': 'Ваша оценка (если не согласны с ИИ)', 'master.score_changed': 'Оценка изменена мастером',
  'master.reassign': 'Переназначить', 'master.cancel': 'Отменить наряд', 'master.cancel_confirm': 'Отменить наряд?',

  'event.issue': 'Выдан', 'event.accept': 'Принят', 'event.queue': 'Поставлен в очередь', 'event.reject': 'Отклонён',
  'event.start': 'Начато исполнение', 'event.pause': 'Приостановлен', 'event.complete': 'Исполнено', 'event.ai_verdict': 'Вердикт ИИ',
  'event.approve': 'Закрыт мастером', 'event.return': 'Возвращён мастером', 'event.cancel': 'Отменён', 'event.reassign': 'Переназначен',
  'event.priority': 'Изменён приоритет',

  'panel.title': 'Аналитика', 'panel.dashboard': 'Дашборд', 'panel.shift': 'Отчёт за смену', 'panel.rating': 'Рейтинг',
  'panel.anomalies': 'Аномалии ИИ', 'panel.materials': 'Материалы', 'panel.downtime': 'Простои', 'panel.assistant': 'ИИ-ассистент',
  'panel.export_hint': 'PDF — через «Печать → Сохранить как PDF»',
  'period.shift': 'Смена', 'period.day': 'Сутки', 'period.week': 'Неделя', 'period.month': 'Месяц', 'period.quarter': '3 месяца',
  'kpi.in_work': 'Наряды в работе', 'kpi.overdue': 'Просрочено сейчас', 'kpi.reaction': 'Среднее время реакции', 'kpi.exec': 'Среднее время выполнения',
  'kpi.on_time': 'Выполнено в срок', 'kpi.downtime': 'Простой оборудования', 'kpi.top_equipment': 'Топ-5 проблемного оборудования (внеплановые наряды)',
  'kpi.best': 'Лучшие исполнители (рейтинг)', 'kpi.weekly': 'Наряды по неделям',
  'shift.summary': 'Сводка ИИ', 'shift.issued': 'Выдано', 'shift.done': 'Выполнено', 'shift.overdue': 'Просрочено',
  'shift.rejected': 'Отклонено', 'shift.rework': 'Доработок', 'shift.load': 'Загрузка людей, часы',
  'rating.formula_title': 'Как считается рейтинг (0–100)',
  'rating.formula': 'Качество (оценка ИИ/мастера) — 35%, выполнено в срок — 25%, без доработок и повторной поломки за 7 дней — 20%, объём и сложность нарядов — 15%, отказы без уважительной причины — 5%. Качество весит больше всего: плохой ремонт приводит к повторной аварии.',
  'rating.workers': 'Исполнители', 'rating.brigades': 'Бригады', 'rating.worker': 'Исполнитель', 'rating.total': 'Рейтинг',
  'rating.quality': 'Оценка', 'rating.on_time': 'В срок', 'rating.clean': 'Без возвратов', 'rating.volume': 'Объём', 'rating.orders': 'Нарядов',
  'rating.explain': 'Из чего сложился рейтинг: качество {q} из 35 (средняя оценка {qs}), сроки {ot} из 25 ({otp} в срок), без доработок {c} из 20 ({cp}), объём {v} из 15, дисциплина {d} из 5.',
  'rating.advice_clean': 'Главный резерв — меньше возвратов и повторных поломок: проверяйте узел после ремонта.',
  'rating.advice_time': 'Резерв — сроки: при задержке ставьте паузу с причиной, чтобы мастер видел.',
  'anomaly.loading': 'ИИ анализирует историю нарядов…', 'anomaly.intro': 'Закономерности, найденные в истории нарядов за 3 месяца.',
  'anomaly.top_problem': 'Проблемное оборудование', 'anomaly.repeat_fault': 'Повторная неисправность', 'anomaly.after_ppr': 'Поломки после ППР',
  'anomaly.worker_quality': 'Качество исполнителя', 'anomaly.material_overuse': 'Перерасход материалов', 'anomaly.rising_trend': 'Прогноз отказа',
  'mat.material': 'Материал', 'mat.qty': 'Списано', 'mat.norm': 'Норма', 'mat.ratio': 'К норме', 'mat.orders': 'Нарядов', 'mat.top_brigade': 'Больше всех',
  'down.title': 'Простой по оборудованию, часы', 'down.unplanned': 'Внеплановых', 'down.planned': 'Плановых', 'down.hours': 'Простой, ч', 'down.code': 'Частый шифр',
  'asst.q1': 'Кто сейчас свободен из электриков?', 'asst.q2': 'Что просрочено на смене?', 'asst.q3': 'Какое оборудование сейчас в простое?',
  'asst.ph': 'Спросите про смену…', 'asst.ask': 'Спросить',

  'settings.title': 'Настройки', 'settings.tg_intro': 'Наряды и напоминания будут приходить в Telegram с кнопками «Принять» / «В очередь».',
  'settings.tg_connect': 'Подключить Telegram', 'settings.tg_open': 'Открыть бота', 'settings.tg_connected': 'Telegram подключён',
  'settings.tg_not_ready': 'Бот ещё не настроен администратором.', 'settings.tg_setup': 'Настроить бота (мастер/админ)',
  'settings.no_token': 'Нет TELEGRAM_BOT_TOKEN в секретах Supabase', 'settings.bad_token': 'Токен бота не принят Telegram',
  'settings.browser_notif': 'Уведомления в браузере', 'settings.allow_notif': 'Разрешить уведомления',
  'settings.demo': 'Демо-режим', 'settings.demo_text': 'Готовит «живую» смену для защиты: закрывает открытые наряды и создаёт 5 нарядов в работе и в очереди.',
  'settings.reset': 'Подготовить смену к демо', 'settings.reset_confirm': 'Все открытые наряды будут отменены. Продолжить?',
  'settings.reset_done': 'Готово: создано {n} нарядов', 'settings.qr_print': 'QR-коды оборудования', 'settings.dataset': 'Тестовый набор данных (SQL)',
  'qr.scan': 'QR', 'qr.title': 'Наведите камеру на QR-код оборудования', 'qr.no_camera': 'Нет доступа к камере', 'qr.unknown': 'QR-код не распознан как оборудование',
  'qr.print_title': 'QR-коды оборудования', 'qr.print': 'Печать',
  'offline.queued': 'Нет сети — действие сохранено и отправится автоматически', 'offline.banner': 'Нет сети. Нажатия сохраняются на телефоне.',
  'offline.pending': 'Ждут отправки: {n}',

  'notif.empty': 'Пока нет уведомлений',
  'worker.count': 'Нарядов в работе: {n}', 'worker.empty_hint': 'Новый наряд придёт сюда и в Telegram со звуком.', 'worker.on_check': 'На проверке у ИИ и мастера',
  'board.subtitle': 'Свободно {free} из {all} на смене', 'board.new_short': 'Новый наряд',
  'legend.busy': 'В работе', 'legend.queue': 'Есть очередь', 'board.toggle_hint': 'Нажмите на человека — «на смене / нет»',
  'board.hide_off': 'Скрыть не на смене', 'board.show_off': 'Показать не на смене ({n})',
  'form.subtitle': '4 шага, меньше минуты', 'form.step1': 'Что сломалось', 'form.step2': 'Срочность', 'form.step3': 'Кто сделает', 'form.step4': 'Срок и фото',
  'qr.scan_long': 'Сканировать QR-код', 'form.emergency_hint': 'Аварийный наряд придёт со звуком и вибрацией; не принят за 3 мин — вам придёт эскалация.',
  'form.pick_equipment_first': 'Сначала выберите оборудование — ИИ подберёт исполнителя.', 'form.best': 'лучший выбор', 'form.hide_all': 'Скрыть список',
  'form.comment_ph': 'Необязательно', 'form.issue_to': 'Выдать: {eq} → {who}', 'form.fill_hint': 'Заполните оборудование, описание и исполнителя',
  'form.shoot': 'Снять', 'form.gallery': 'Из галереи',
  'camera.denied': 'Нет доступа к камере. Разрешите камеру в настройках браузера или нажмите «Отмена» и выберите фото из галереи.',
  'camera.title': 'Фото', 'camera.system': 'Открыть камеру телефона', 'camera.done': 'Готово', 'camera.shoot': 'Сделать снимок', 'camera.flip': 'Сменить камеру',
  'close.title': 'Закрытие наряда', 'close.step1': 'Что сделано', 'close.step2': 'Материалы', 'close.step3': 'Фото результата',
  'close.typical_hint': 'Обычно для этой неисправности списывают — нажмите, чтобы добавить:', 'close.required': 'обязательно',
  'close.photo_hint': 'Снимите отремонтированный узел так, чтобы было видно, что неисправность устранена.', 'close.comment_ph': 'Например: рекомендую замену через месяц',
  'close.fill_hint': 'Опишите, что сделано',
  'login.help': 'Забыли ПИН? Обратитесь к администратору участка.',
  'admin.people': 'Сотрудники', 'admin.catalog': 'Справочники', 'admin.people_sub': 'Исполнителей: {w}, мастеров: {m}', 'admin.add': 'Добавить',
  'admin.created': 'Готово: {name}, табельный {tab}, ПИН', 'admin.created_hint': 'Передайте ПИН сотруднику лично — повторно он не показывается.',
  'admin.search': 'Поиск: ФИО, табельный №', 'admin.all_roles': 'Все роли', 'admin.show_fired': 'Показать уволенных', 'admin.nobody': 'Никого не найдено',
  'admin.name': 'ФИО', 'admin.tab': 'Табельный №', 'admin.role': 'Роль', 'admin.specialty': 'Специальность', 'admin.brigade': 'Бригада',
  'admin.fired': 'уволен', 'admin.grade_short': 'разр.', 'admin.new_person': 'Новый сотрудник', 'admin.grade': 'Разряд',
  'admin.new_pin': 'Новый ПИН (если нужно сменить)', 'admin.pin': 'ПИН для входа (6 цифр)', 'admin.pin_keep': 'оставить прежний', 'admin.gen_pin': 'Придумать',
  'admin.save': 'Сохранить', 'admin.create': 'Добавить сотрудника', 'admin.fire': 'Уволить (вход будет закрыт)', 'admin.rehire': 'Вернуть на работу',
  'admin.fire_confirm': 'Уволить {name}? История нарядов сохранится, вход будет закрыт.',
  'catalog.sub': 'Участки, оборудование и бригады предприятия', 'catalog.equipment': 'Оборудование', 'catalog.sites': 'Участки', 'catalog.brigades': 'Бригады',
  'catalog.empty': 'Оборудование ещё не добавлено', 'catalog.inv': 'Инв. №', 'catalog.type': 'Тип', 'catalog.crit': 'Критичность',
  'catalog.crit1': 'Критичное', 'catalog.crit2': 'Важное', 'catalog.crit3': 'Обычное', 'catalog.name_kk': 'Название на казахском', 'catalog.units': 'Единиц',
  'catalog.new_equipment': 'Новое оборудование', 'catalog.new_sites': 'Новый участок', 'catalog.new_brigades': 'Новая бригада', 'catalog.name': 'Название',
  'catalog.duplicate': 'Такое название или инв. № уже есть',
  'setup.title': 'Нужна настройка',
  'setup.text': 'Создайте файл web/.env по образцу web/.env.example (адрес и anon-ключ проекта Supabase) и перезапустите npm run dev.',
}

type Key = keyof typeof ru

// Экраны исполнителя и основные статусы — на казахском; аналитика пока на русском
const kk: Partial<Record<Key, string>> = {
  'app.slogan': 'Наряд берілді — ЖИ бақылауда',
  'login.tab': 'Табель нөмірі', 'login.pin': 'PIN-код', 'login.submit': 'Кіру',
  'login.error': 'Табель нөмірі немесе PIN қате', 'nav.logout': 'Шығу', 'nav.back': 'Артқа', 'nav.notifications': 'Хабарламалар',
  'role.master': 'Ауысым шебері', 'role.worker': 'Орындаушы', 'role.manager': 'Басшы', 'role.admin': 'Әкімші',
  'status.issued': 'Берілді', 'status.accepted': 'Қабылданды', 'status.queued': 'Кезекте', 'status.rejected': 'Бас тартылды',
  'status.in_progress': 'Жұмыста', 'status.paused': 'Тоқтатылды', 'status.done': 'Орындалды',
  'status.ai_review': 'ЖИ тексеруі', 'status.rework': 'Пысықтауда', 'status.closed': 'Жабылды', 'status.cancelled': 'Болдырылмады',
  'priority.emergency': 'Апаттық', 'priority.high': 'Жоғары', 'priority.normal': 'Қалыпты', 'priority.planned': 'Жоспарлы',
  'live.free': 'Бос', 'live.busy': '№{n} орындауда', 'live.queue': 'Кезекте: {n}', 'live.off_shift': 'Ауысымда емес',
  'col.issued': 'Берілген', 'col.accepted': 'Қабылданған', 'col.in_progress': 'Жұмыста', 'col.queued': 'Кезекте',
  'col.done': 'Орындалған', 'col.overdue': 'Мерзімі өткен',
  'board.title': 'Ауысым', 'board.people': 'Орындаушылар', 'board.new': '+ Жаңа наряд',
  'action.accept': 'Жұмысқа қабылдау', 'action.queue': 'Кезекке қою', 'action.reject': 'Бас тарту',
  'action.start': 'Орындауды бастау', 'action.pause': 'Тоқтата тұру', 'action.complete': 'Орындалды',
  'reason.title': 'Себебін көрсетіңіз', 'reason.cancel': 'Болдырмау',
  'reason.no_materials': 'Материал жоқ', 'reason.no_permit': 'Рұқсат жоқ', 'reason.busy_emergency': 'Апаттық нарядпен бос емес',
  'reason.wait_parts': 'Қосалқы бөлшек күтуде', 'reason.wait_stop': 'Жабдықтың тоқтауын күтуде', 'reason.wait_permit': 'Рұқсат күтуде',
  'worker.title': 'Менің нарядтарым', 'worker.empty': 'Нарядтар жоқ', 'worker.due': 'Мерзімі', 'worker.overdue': 'Мерзімі өтті',
  'worker.my_scores': 'Жабылған нарядтарым және бағалар',
  'order.new': 'Жаңа наряд', 'order.title': 'Наряд',
  'close.work': 'Орындалған жұмыстар', 'close.code': 'Ақау шифры', 'close.materials': 'Есептен шығарылған материалдар',
  'close.photo_after': '«Кейін» фотосы', 'close.submit': 'Нарядты жабу', 'close.add_photo': 'Фото түсіру',
  'form.comment': 'Түсініктеме', 'form.photo': 'Фото', 'form.sending': 'Жіберілуде…',
  'ai.check': 'ЖИ тексеруі', 'ai.checking': 'ЖИ нарядты тексеруде…',
  'verdict.accepted': 'Қабылданды', 'verdict.accepted_with_remarks': 'Ескертулермен қабылданды', 'verdict.rework': 'Пысықтау қажет',
  'verdict.needs_master_review': 'Шебердің тексеруі қажет',
  'settings.title': 'Баптаулар', 'settings.tg_connect': 'Telegram қосу',
  'offline.queued': 'Желі жоқ — әрекет сақталды, кейін жіберіледі', 'offline.banner': 'Желі жоқ. Басулар телефонда сақталады.',
  'worker.count': 'Жұмыстағы нарядтар: {n}', 'worker.empty_hint': 'Жаңа наряд осында және Telegram-ға дыбыспен келеді.', 'worker.on_check': 'ЖИ мен шебердің тексеруінде',
  'form.shoot': 'Түсіру', 'form.gallery': 'Галереядан', 'camera.title': 'Фото', 'camera.done': 'Дайын', 'camera.shoot': 'Суретке түсіру', 'camera.flip': 'Камераны ауыстыру',
  'camera.denied': 'Камераға рұқсат жоқ. Браузер баптауларында камераға рұқсат беріңіз.',
  'close.title': 'Нарядты жабу', 'close.step1': 'Не істелді', 'close.step2': 'Материалдар', 'close.step3': 'Нәтиже фотосы', 'close.required': 'міндетті',
  'close.photo_hint': 'Жөнделген түйінді ақау жойылғаны көрінетіндей етіп түсіріңіз.', 'close.fill_hint': 'Не істелгенін жазыңыз',
  'login.help': 'PIN-ды ұмыттыңыз ба? Учаске әкімшісіне хабарласыңыз.', 'notif.empty': 'Әзірге хабарлама жоқ',
  'panel.title': 'Талдау',
}

export type Lang = 'ru' | 'kk'
type T = (key: Key | string, vars?: Record<string, string | number>) => string

const I18nContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: T }>(null!)

function readLang(): Lang {
  try { return localStorage.getItem('lang') === 'kk' ? 'kk' : 'ru' } catch { return 'ru' }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)
  const setLang = (l: Lang) => {
    setLangState(l)
    try { localStorage.setItem('lang', l) } catch { /* приватный режим */ }
  }
  const t: T = (key, vars) => {
    let s: string = (lang === 'kk' && kk[key as Key]) || ru[key as Key] || key
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)

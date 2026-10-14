import numpy as np
import matplotlib.pyplot as plt

initial_capital = 100_000
trade_size = 1_000
win_rate = 0.50
years = 5
trading_days_per_year = 252
total_steps = years * trading_days_per_year
iterations = 10_000

annual_volatility = 0.17
daily_vol = annual_volatility / np.sqrt(trading_days_per_year)


slippage_per_trade = 0.0005

outcomes = np.random.choice([1, -1], size=(iterations, total_steps), p=[win_rate, 1 - win_rate])

market_move = np.abs(np.random.normal(0, daily_vol, size=(iterations, total_steps)))

daily_pnl = (trade_size * market_move * outcomes) - (trade_size * slippage_per_trade)

equity_curves = initial_capital + np.cumsum(daily_pnl, axis=1)

plt.figure(figsize=(12, 6))

plt.plot(equity_curves[:100].T, color='green', alpha=0.05)
plt.plot(np.median(equity_curves, axis=0), color='darkgreen', linewidth=2, label='Медианная кривая')

plt.title(f'Монте-Карло: Фикс. объем ${trade_size}, Winrate {win_rate*100}%, Учет издержек')
plt.xlabel('Торговые дни')
plt.ylabel('Капитал ($)')
plt.axhline(initial_capital, color='black', linestyle='--', label='Старт')
plt.legend()
plt.grid(True, alpha=0.2)
plt.show()

final_values = equity_curves[:, -1]
print(f"--- Результаты через {years} лет ---")
print(f"Средняя финальная сумма: ${np.mean(final_values):,.2f}")
print(f"Вероятность прибыли: {np.mean(final_values > initial_capital)*100:.2f}%")
print(f"Максимальный результат в симуляции: ${np.max(final_values):,.2f}")
print(f"Минимальный результат в симуляции: ${np.min(final_values):,.2f}")
print(f"Ожидаемое кол-во прибыльных сделок: {int(total_steps * win_rate)}")
print(f"Суммарные расходы на комиссии: ${total_steps * trade_size * slippage_per_trade:,.2f}")
